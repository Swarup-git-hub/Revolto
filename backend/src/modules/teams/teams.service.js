import Section from "../../models/Section.js";
import Team from "../../models/Team.js";
import User from "../../models/User.js";
import { nextSeq } from "../../models/Counter.js";
import { badRequest, conflict, forbidden, notFound } from "../../shared/errors.js";
import { getSettings } from "../../shared/settings.js";
import { computeProgress } from "../reviews/progress.service.js";

/** Validates that the user is an active guide (400 otherwise). */
export async function requireActiveGuide(guideId) {
  const guide = await User.findOne({ _id: guideId, role: "guide", isActive: true }, "name activeTeamCount").lean();
  if (!guide) throw badRequest("Select an active guide", { guide: "Select an active guide" });
  return guide;
}

/** Counters of guides created before workload tracking have no value; initialise once from real data. */
async function ensureGuideCounter(guide) {
  if (typeof guide.activeTeamCount === "number") return;
  await User.updateOne({ _id: guide._id, activeTeamCount: { $exists: false } }, { $set: { activeTeamCount: await Team.countDocuments({ guide: guide._id, status: "active" }) } });
}

/**
 * Atomically takes one place in a guide's workload (`activeTeamCount < settings.guide.maxTeams`), so concurrent
 * assignments cannot push a guide over the configured limit. Whoever reserves MUST releaseGuideSlot() if the team is not
 * created / not kept. The configured limit is never changed and nothing is reassigned automatically.
 */
export async function reserveGuideSlot(guideId) {
  const guide = await requireActiveGuide(guideId);
  await ensureGuideCounter(guide);
  const { guide: g } = await getSettings();
  const reserved = await User.findOneAndUpdate(
    { _id: guideId, role: "guide", isActive: true, activeTeamCount: { $lt: g.maxTeams } },
    { $inc: { activeTeamCount: 1 } },
    { new: true }
  );
  if (!reserved) throw conflict(`${guide.name} already guides the maximum of ${g.maxTeams} teams`, { guide: "Guide workload limit reached" });
  return reserved;
}

export async function releaseGuideSlot(guideId) {
  if (!guideId) return;
  await User.updateOne({ _id: guideId, activeTeamCount: { $gt: 0 } }, { $inc: { activeTeamCount: -1 } });
}

export async function generateTeamId(section) {
  const prefix = section.name.toUpperCase().replace(/[^A-Z0-9]/g, "") || "T";
  for (let i = 0; i < 20; i++) {
    const id = `${prefix}-T${String(await nextSeq(`team:${section._id}`)).padStart(2, "0")}`;
    if (!(await Team.exists({ teamId: id }))) return id;
  }
  throw conflict("Could not generate a unique team id");
}

export async function memberCount(teamId) {
  return User.countDocuments({ team: teamId, role: "student", isActive: true });
}

/** Adds an unassigned student of the team's section. Enforces the configured maximum team size. */
export async function addMember(team, studentId) {
  const { team: limits } = await getSettings();
  if ((await memberCount(team._id)) >= limits.maxSize) throw conflict(`A team can have at most ${limits.maxSize} members`);
  const claimed = await User.findOneAndUpdate({ _id: studentId, role: "student", isActive: true, team: null, section: team.section }, { $set: { team: team._id } }, { new: true });
  if (!claimed) {
    const s = await User.findById(studentId, "role isActive team section").lean();
    if (!s || s.role !== "student" || !s.isActive) throw notFound("Student not found");
    if (s.team) throw conflict("This student already belongs to a team");
    throw conflict("The student belongs to a different section than the team");
  }
  if ((await memberCount(team._id)) > limits.maxSize) {
    await User.updateOne({ _id: studentId }, { $set: { team: null } });
    throw conflict(`A team can have at most ${limits.maxSize} members`);
  }
  if (!team.leader) await Team.updateOne({ _id: team._id, leader: null }, { $set: { leader: claimed._id } });
  return claimed;
}

/**
 * Removes a member. The current leader can only be removed together with a replacement (an active member of the SAME
 * team), and the leader is switched BEFORE the membership is removed, so a team is never left without a leader.
 */
export async function removeMember(team, studentId, { replacementLeaderId } = {}) {
  const member = await User.findOne({ _id: studentId, team: team._id }, "name rollNumber").lean();
  if (!member) throw notFound("That student is not a member of this team");
  const isLeader = team.leader && String(team.leader) === String(studentId);
  let replacement = null;

  if (isLeader) {
    const field = "replacementLeaderId";
    if (!replacementLeaderId) {
      const others = await User.countDocuments({ team: team._id, _id: { $ne: studentId }, role: "student", isActive: true });
      if (!others) throw conflict("This student is the only member and the team leader. Add another member first, or archive the team.", { [field]: "No other member can take over" });
      throw badRequest("Choose a new team leader before removing the current leader", { [field]: "Required when removing the team leader" });
    }
    if (String(replacementLeaderId) === String(studentId)) throw badRequest("The replacement must be a different member", { [field]: "Pick another member" });
    replacement = await User.findOne({ _id: replacementLeaderId, team: team._id, role: "student", isActive: true }, "name rollNumber").lean();
    if (!replacement) throw badRequest("The replacement leader must be an active member of this team", { [field]: "Pick an active member of this team" });
    const switched = await Team.updateOne({ _id: team._id, leader: studentId }, { $set: { leader: replacement._id } });
    if (!switched.modifiedCount) throw conflict("The team leader changed in the meantime. Please reload and try again.");
  }
  await User.updateOne({ _id: studentId, team: team._id }, { $set: { team: null } });
  return { member, replacement, wasLeader: Boolean(isLeader) };
}

const id = (x) => (x?._id ? String(x._id) : x ? String(x) : null);

export function shapeTeam(team, progress, { detailed = false } = {}) {
  const base = {
    id: String(team._id),
    teamId: team.teamId,
    projectTitle: team.projectTitle || "",
    titleStatus: team.titleStatus,
    status: team.status,
    section: team.section?.name ? { id: id(team.section), name: team.section.name } : { id: id(team.section) },
    guide: team.guide?.name ? { id: id(team.guide), name: team.guide.name, email: team.guide.email } : { id: id(team.guide) },
    leader: team.leader?.name ? { id: id(team.leader), name: team.leader.name } : team.leader ? { id: id(team.leader) } : null,
    createdAt: team.createdAt,
  };
  if (progress) {
    base.memberCount = progress.members.length;
    base.progress = {
      currentReview: progress.currentReview,
      reviewsApproved: progress.reviewsApproved,
      reviewsSubmitted: progress.reviewsSubmitted,
      reviewsTotal: progress.reviewsTotal,
      milestones: { recorded: progress.milestones.recorded, total: progress.milestones.total, completed: progress.milestones.completed, inProgress: progress.milestones.inProgress },
      progressState: progress.progressState,
      reportStatus: progress.reportStatus,
      lastUpdate: progress.lastUpdate,
    };
    if (detailed) {
      base.progress.reviews = progress.reviews;
      base.progress.milestones = progress.milestones;
      base.progress.pendingWork = progress.pendingWork;
      base.members = progress.members.map((m) => ({ ...m, isLeader: String(team.leader?._id || team.leader) === m.id }));
    }
  }
  return base;
}

export async function loadTeamsWithProgress(filter, { sort = { teamId: 1 }, skip = 0, limit = 200 } = {}) {
  const teams = await Team.find(filter).populate("section", "name").populate("guide", "name email").populate("leader", "name").sort(sort).skip(skip).limit(limit).lean();
  const progress = await computeProgress(teams);
  return { teams, progress };
}

export function assertCanManageMembers(user, team) {
  const isGuide = user.role === "guide" && String(team.guide) === user.id;
  const isManager = user.role === "hod" || (user.role === "coordinator" && user.sections.includes(String(team.section)));
  if (!isGuide && !isManager) throw forbidden();
}

export async function sectionOrThrow(sectionId) {
  const s = await Section.findOne({ _id: sectionId, isActive: true }).lean();
  if (!s) throw badRequest("Select an active section", { section: "Select an active section" });
  return s;
}
