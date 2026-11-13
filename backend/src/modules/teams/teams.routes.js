import { Router } from "express";
import Team from "../../models/Team.js";
import User from "../../models/User.js";
import { audit } from "../../shared/audit.js";
import { authorize, protect } from "../../shared/auth.js";
import { asyncHandler, badRequest, conflict, forbidden, notFound } from "../../shared/errors.js";
import { notify } from "../../shared/notify.js";
import { loadScopedTeam, teamScopeFilter } from "../../shared/scope.js";
import { getSettings } from "../../shared/settings.js";
import { Validator, escapeRegex, pageParams, parseId } from "../../shared/validate.js";
import Submission from "../../models/Submission.js";
import { assertCanManageMembers, addMember, generateTeamId, loadTeamsWithProgress, releaseGuideSlot, removeMember, requireActiveGuide, reserveGuideSlot, sectionOrThrow, shapeTeam } from "./teams.service.js";

const router = Router();
router.use(protect);

const detail = async (user, idOrTeamId) => {
  const t = await loadScopedTeam(user, idOrTeamId);
  const { teams, progress } = await loadTeamsWithProgress({ _id: t._id });
  const { team: limits } = await getSettings();
  const out = shapeTeam(teams[0], progress.get(String(t._id)), { detailed: true });
  out.titleHistory = t.titleHistory;
  out.limits = limits;
  out.belowMinSize = out.memberCount < limits.minSize;
  return out;
};

router.get("/", asyncHandler(async (req, res) => {
  const { page, limit, skip } = pageParams(req.query);
  const q = req.query;
  const and = [teamScopeFilter(req.user)];
  if (q.section) and.push({ section: parseId(q.section, "section") });
  if (q.guide) and.push({ guide: parseId(q.guide, "guide") });
  if (q.status === "archived") and.push({ status: "archived" });
  else if (q.status !== "all") and.push({ status: "active" });
  if (q.search) {
    const rx = new RegExp(escapeRegex(String(q.search).slice(0, 60)), "i");
    and.push({ $or: [{ teamId: rx }, { projectTitle: rx }] });
  }
  const filter = { $and: and };
  const [{ teams, progress }, total] = await Promise.all([loadTeamsWithProgress(filter, { skip, limit }), Team.countDocuments(filter)]);
  res.json({ teams: teams.map((t) => shapeTeam(t, q.withProgress === "false" ? null : progress.get(String(t._id)))), total, page, limit });
}));

router.get("/:id", asyncHandler(async (req, res) => res.json({ team: await detail(req.user, req.params.id) })));

router.post("/", authorize("hod", "coordinator"), asyncHandler(async (req, res) => {
  const v = new Validator(req.body);
  const sectionId = v.id("section", { required: true });
  const guideId = v.id("guide", { required: true });
  const requestedId = v.string("teamId", { max: 30 });
  const projectTitle = v.string("projectTitle", { max: 200 });
  const memberIds = (v.array("memberIds", { max: 20 }) || []).map((m) => parseId(m, "member id"));
  const leaderId = v.id("leader");
  v.done();
  if (req.user.role === "coordinator" && !req.user.sections.includes(sectionId)) throw forbidden("You can only create teams in your assigned sections");
  const section = await sectionOrThrow(sectionId);
  await requireActiveGuide(guideId);
  const { team: limits } = await getSettings();
  if (memberIds.length > limits.maxSize) throw conflict(`A team can have at most ${limits.maxSize} members`);
  if (leaderId && !memberIds.includes(leaderId)) throw badRequest("The leader must be one of the members", { leader: "Pick a member" });

  let teamId = requestedId ? requestedId.toUpperCase() : null;
  if (teamId && !/^[A-Z0-9][A-Z0-9_-]{1,29}$/.test(teamId)) throw badRequest("Team id may contain letters, numbers, hyphens and underscores", { teamId: "Invalid team id" });
  if (teamId && (await Team.exists({ teamId }))) throw conflict("That team id is already in use", { teamId: "Already in use" });
  teamId ??= await generateTeamId(section);

  await reserveGuideSlot(guideId); // atomic; released on any failure below
  let team;
  try {
    team = await Team.create({ teamId, section: sectionId, guide: guideId, projectTitle: projectTitle || "", titleStatus: projectTitle ? "submitted" : "not_submitted", createdBy: req.user._id });
  } catch (err) {
    await releaseGuideSlot(guideId);
    throw err;
  }
  try {
    for (const m of memberIds) await addMember(team, m);
    if (leaderId) await Team.updateOne({ _id: team._id }, { $set: { leader: leaderId } });
  } catch (err) {
    await User.updateMany({ team: team._id }, { $set: { team: null } });
    await Team.deleteOne({ _id: team._id }); // brand-new team with no history: safe to roll back
    await releaseGuideSlot(guideId);
    throw err;
  }
  await audit(req.user, { action: "CREATE", entity: "Team", entityId: team._id, entityName: teamId, after: { teamId, section: sectionId, guide: guideId, memberIds }, ip: req.ip });
  await notify([guideId, ...memberIds], { type: "team_assigned", title: "Team assignment", message: `Team ${teamId} has been set up for you.`, link: `/teams/${team._id}` });
  res.status(201).json({ team: await detail(req.user, team._id) });
}));

/** Guide reassignment, leader changes. HOD/Coordinator manage structure; the assigned Guide may only set the leader. */
router.patch("/:id", asyncHandler(async (req, res) => {
  const team = await loadScopedTeam(req.user, req.params.id);
  assertCanManageMembers(req.user, team);
  const isManager = req.user.role !== "guide";
  const v = new Validator(req.body);
  const guideId = isManager ? v.id("guide") : undefined;
  const leaderId = v.id("leader");
  v.done();
  const before = { guide: team.guide, leader: team.leader };
  const oldGuide = String(team.guide);
  let reservedFor = null; // only ACTIVE teams count towards a guide's workload
  try {
    if (guideId && guideId !== oldGuide) {
      if (team.status === "active") { await reserveGuideSlot(guideId); reservedFor = guideId; }
      else await requireActiveGuide(guideId);
      team.guide = guideId;
    }
    if (leaderId && leaderId !== String(team.leader)) {
      if (!(await User.exists({ _id: leaderId, team: team._id, isActive: true }))) throw badRequest("The leader must be an active member of the team", { leader: "Pick a member" });
      team.leader = leaderId;
    }
    await team.save();
  } catch (err) {
    if (reservedFor) await releaseGuideSlot(reservedFor);
    throw err;
  }
  if (reservedFor) await releaseGuideSlot(oldGuide);
  await audit(req.user, { action: "UPDATE", entity: "Team", entityId: team._id, entityName: team.teamId, before, after: { guide: team.guide, leader: team.leader }, ip: req.ip });
  if (guideId) await notify([guideId], { type: "team_assigned", title: "New team assigned", message: `You are now the guide for ${team.teamId}.`, link: `/teams/${team._id}` });
  res.json({ team: await detail(req.user, team._id) });
}));

router.post("/:id/members", asyncHandler(async (req, res) => {
  const team = await loadScopedTeam(req.user, req.params.id);
  assertCanManageMembers(req.user, team);
  if (team.status !== "active") throw conflict("Archived teams cannot be changed");
  const v = new Validator(req.body);
  const studentId = v.id("studentId", { required: true });
  v.done();
  const student = await addMember(team, studentId);
  await audit(req.user, { action: "UPDATE", entity: "Team", entityId: team._id, entityName: team.teamId, after: { addedMember: student.rollNumber || student.email }, ip: req.ip });
  await notify([student._id], { type: "team_member_added", title: "Added to a team", message: `You were added to team ${team.teamId}.`, link: `/teams/${team._id}` });
  res.status(201).json({ team: await detail(req.user, team._id) });
}));

router.delete("/:id/members/:studentId", asyncHandler(async (req, res) => {
  const team = await loadScopedTeam(req.user, req.params.id);
  assertCanManageMembers(req.user, team);
  if (team.status !== "active") throw conflict("Archived teams cannot be changed");
  const studentId = parseId(req.params.studentId, "student id");
  const replacementLeaderId = req.query.replacementLeaderId ? parseId(String(req.query.replacementLeaderId), "replacement leader id") : undefined;
  const { member, replacement, wasLeader } = await removeMember(team, studentId, { replacementLeaderId });
  const who = member.rollNumber || member.name;
  await audit(req.user, {
    action: "UPDATE", entity: "Team", entityId: team._id, entityName: team.teamId,
    before: wasLeader ? { leader: who, member: who } : { member: who },
    after: wasLeader ? { leader: replacement.rollNumber || replacement.name, removedMember: who } : { removedMember: who },
    reason: wasLeader ? "Team leader removed; replacement leader appointed" : undefined, ip: req.ip,
  });
  await notify([studentId], { type: "team_member_removed", title: "Removed from a team", message: `You were removed from team ${team.teamId}.` });
  if (wasLeader) {
    const others = await User.find({ team: team._id, isActive: true, _id: { $ne: replacement._id } }, "_id").lean();
    await notify([replacement._id], { type: "team_leader_changed", title: "You are now the team leader", message: `You are now the leader of team ${team.teamId}.`, link: `/teams/${team._id}` });
    await notify(others.map((o) => o._id), { type: "team_leader_changed", title: "Team leader changed", message: `${replacement.name} is now the leader of team ${team.teamId}.`, link: `/teams/${team._id}` });
  }
  res.json({ team: await detail(req.user, team._id) });
}));

/** Central title management. Edits by the Guide / Coordinator / HOD always record old value, new value, actor, time and reason. */
router.patch("/:id/title", authorize("guide", "coordinator", "hod"), asyncHandler(async (req, res) => {
  const team = await loadScopedTeam(req.user, req.params.id);
  const v = new Validator(req.body);
  const projectTitle = v.string("projectTitle", { required: true, min: 3, max: 200 });
  const reason = v.string("reason", { required: true, min: 5, max: 500 });
  v.done();
  if (projectTitle === team.projectTitle) throw badRequest("The title is unchanged", { projectTitle: "Enter a different title" });
  const { reviews } = await getSettings();
  const oldTitle = team.projectTitle;
  const oldStatus = team.titleStatus;
  team.titleHistory.push({ oldTitle, newTitle: projectTitle, actor: req.user._id, actorName: req.user.name, reason, at: new Date() });
  team.projectTitle = projectTitle;
  if (oldStatus === "confirmed" && reviews.requireTitleReconfirmation) team.titleStatus = "submitted";
  else if (oldStatus === "not_submitted") team.titleStatus = "submitted";
  await team.save();
  await audit(req.user, { action: "UPDATE", entity: "Team", entityId: team._id, entityName: team.teamId, before: { projectTitle: oldTitle, titleStatus: oldStatus }, after: { projectTitle, titleStatus: team.titleStatus }, reason, ip: req.ip });
  const members = await User.find({ team: team._id, isActive: true }, "_id").lean();
  await notify(members.map((m) => m._id), { type: "title_changed", title: "Project title updated", message: `The title of ${team.teamId} was changed. Reason: ${reason}`, link: `/teams/${team._id}` });
  res.json({ team: await detail(req.user, team._id) });
}));

/** Assigned Guide confirms the current title (needed again after an edit when reconfirmation is required). */
router.post("/:id/title/confirm", authorize("guide"), asyncHandler(async (req, res) => {
  const team = await loadScopedTeam(req.user, req.params.id);
  if (!team.projectTitle) throw conflict("There is no title to confirm yet");
  if (team.titleStatus === "confirmed") return res.json({ team: await detail(req.user, team._id) });
  team.titleStatus = "confirmed";
  await team.save();
  await Submission.updateOne({ team: team._id, reviewType: "title", isLatest: true, status: { $in: ["submitted", "under_review"] } }, { $set: { status: "approved" }, $push: { reviewHistory: { decision: "approved", feedback: "Title confirmed", by: req.user._id, byName: req.user.name, at: new Date() } } });
  const members = await User.find({ team: team._id, isActive: true }, "_id").lean();
  await notify(members.map((m) => m._id), { type: "title_confirmed", title: "Title confirmed", message: `Your guide confirmed the title of ${team.teamId}.`, link: `/teams/${team._id}` });
  res.json({ team: await detail(req.user, team._id) });
}));

router.post("/:id/archive", authorize("hod", "coordinator"), asyncHandler(async (req, res) => {
  const team = await loadScopedTeam(req.user, req.params.id);
  // conditional update: only the call that really flips active → archived releases the guide's place
  const flipped = await Team.findOneAndUpdate({ _id: team._id, status: "active" }, { $set: { status: "archived", archivedAt: new Date() } });
  if (!flipped) throw conflict("Team is already archived");
  await releaseGuideSlot(flipped.guide);
  await audit(req.user, { action: "ARCHIVE", entity: "Team", entityId: team._id, entityName: team.teamId, reason: req.body?.reason, ip: req.ip });
  res.json({ team: await detail(req.user, team._id) });
}));

router.post("/:id/restore", authorize("hod", "coordinator"), asyncHandler(async (req, res) => {
  const team = await loadScopedTeam(req.user, req.params.id);
  if (team.status === "active") throw conflict("Team is already active");
  await reserveGuideSlot(team.guide);
  const flipped = await Team.findOneAndUpdate({ _id: team._id, status: "archived", guide: team.guide }, { $set: { status: "active", archivedAt: null } });
  if (!flipped) {
    await releaseGuideSlot(team.guide);
    throw conflict("The team changed while restoring. Please try again.");
  }
  await audit(req.user, { action: "RESTORE", entity: "Team", entityId: team._id, entityName: team.teamId, ip: req.ip });
  res.json({ team: await detail(req.user, team._id) });
}));

export { notFound };
export default router;
