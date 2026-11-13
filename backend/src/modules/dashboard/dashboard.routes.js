import { Router } from "express";
import mongoose from "mongoose";
import BookingRequest from "../../models/BookingRequest.js";
import BookingSlot from "../../models/BookingSlot.js";
import ReviewConfig from "../../models/ReviewConfig.js";
import Section from "../../models/Section.js";
import Team from "../../models/Team.js";
import User from "../../models/User.js";
import { protect } from "../../shared/auth.js";
import { asyncHandler } from "../../shared/errors.js";
import { teamScopeFilter } from "../../shared/scope.js";
import { getSettings } from "../../shared/settings.js";
import { fromMin, todayStr } from "../../shared/time.js";
import { computeProgress } from "../reviews/progress.service.js";
import { policyForSection } from "../bookings/bookings.service.js";

const router = Router();
router.use(protect);

/** Basic recorded-progress overview. Review status and milestone progress are reported separately; there are no scores or predictions. */
/** Effective reviews for a section: a section-level review overrides the college-wide one with the same key. */
function effectiveFor(configs, sectionId) {
  const byKey = new Map();
  for (const c of configs.filter((c) => !c.section || String(c.section) === String(sectionId)).sort((a, b) => (a.section ? 1 : 0) - (b.section ? 1 : 0))) byKey.set(c.key, c);
  return [...byKey.values()].sort((a, b) => a.order - b.order);
}

/**
 * Staff summary computed by streaming ONE aggregation over the teams in scope (each team joined with only its *latest*
 * submissions / pending contributions, projected to a few fields). Totals therefore never depend on a page size or a row
 * cap, and project histories are never loaded.
 */
async function summarizeScope(user, teamFilter) {
  const [configs, sections] = await Promise.all([
    ReviewConfig.find({ archivedAt: null }, "key order section type").lean(),
    Section.find(user.role === "hod" ? { isActive: true } : { _id: { $in: user.sections }, isActive: true }).sort({ name: 1 }).lean(),
  ]);
  const secOut = new Map(sections.map((s) => [String(s._id), { id: String(s._id), name: s.name, teams: 0, reviewsApproved: 0, reviewsTotal: 0, reportsApproved: 0 }]));
  const reviewCache = new Map();
  const reviewsOf = (sid) => reviewCache.get(sid) || (reviewCache.set(sid, effectiveFor(configs, sid)), reviewCache.get(sid));

  const t = { teamCount: 0, teamsByCurrentReview: { not_started: 0 }, teamsWithoutMilestoneRecord: 0, reportsApproved: 0, awaitingGuideReview: 0, contributionsPending: 0, awaitingCorrection: 0 };
  const cursor = Team.aggregate([
    { $match: teamFilter },
    { $project: { section: 1 } },
    { $lookup: { from: "submissions", localField: "_id", foreignField: "team", as: "subs", pipeline: [{ $match: { isLatest: true } }, { $project: { reviewKey: 1, reviewType: 1, status: 1 } }] } },
    { $lookup: { from: "contributions", localField: "_id", foreignField: "team", as: "pending", pipeline: [{ $match: { isLatest: true, status: "pending_review" } }, { $project: { _id: 1 } }] } },
  ]).cursor({ batchSize: 500 });

  for await (const team of cursor) {
    const sid = String(team.section);
    const reviews = reviewsOf(sid);
    const byKey = new Map(team.subs.map((x) => [x.reviewKey, x]));
    const statusOf = (r) => byKey.get(r.key)?.status || "not_submitted";
    const approved = reviews.filter((r) => statusOf(r) === "approved").length;
    const current = reviews.find((r) => statusOf(r) !== "approved");
    const key = current?.key || "all_approved";
    t.teamCount++;
    t.teamsByCurrentReview[key] = (t.teamsByCurrentReview[key] || 0) + 1;
    if (!team.subs.some((x) => x.reviewType === "progress")) t.teamsWithoutMilestoneRecord++;
    const reportApproved = team.subs.some((x) => x.reviewType === "report" && x.status === "approved") && reviews.some((r) => r.type === "report");
    if (reportApproved) t.reportsApproved++;
    t.awaitingGuideReview += team.subs.filter((x) => ["submitted", "under_review"].includes(x.status)).length;
    if (team.subs.some((x) => x.status === "changes_required")) t.awaitingCorrection++;
    t.contributionsPending += team.pending.length;
    const row = secOut.get(sid);
    if (row) { row.teams++; row.reviewsApproved += approved; row.reviewsTotal += reviews.length; if (reportApproved) row.reportsApproved++; }
  }
  return { ...t, sections: [...secOut.values()] };
}

const requestScope = async (u) => (u.role === "hod" ? {} : u.role === "coordinator" ? { section: { $in: u.sections } } : { team: { $in: await Team.distinct("_id", { guide: u._id }) } });

/** Basic recorded-progress overview. Review stages and milestone progress are reported separately; there are no scores or predictions. */
router.get("/", asyncHandler(async (req, res) => {
  const u = req.user;
  const settings = await getSettings();
  const today = todayStr(settings.college.timezoneOffsetMinutes);
  const out = { role: u.role };
  const teamFilter = { $and: [teamScopeFilter(u), { status: "active" }] }; // used with find(), which casts ids

  if (u.role === "student") {
    const teams = await Team.find(teamFilter).populate("section", "name").populate("guide", "name").limit(1).lean();
    const team = teams[0];
    if (!team) return res.json({ ...out, team: null });
    const p = (await computeProgress(teams)).get(String(team._id));
    const { policy } = await policyForSection(team.section._id);
    const myBookings = await BookingRequest.find({ team: team._id, active: true }).populate("slot", "date startMin endMin").lean();
    return res.json({
      ...out,
      team: { id: String(team._id), teamId: team.teamId, projectTitle: team.projectTitle, titleStatus: team.titleStatus, section: team.section.name, guide: team.guide.name, isLeader: String(team.leader) === u.id },
      progress: p,
      corrections: p.reviews.filter((r) => r.status === "changes_required"),
      bookingEnabled: policy.enabled,
      bookings: myBookings.map((b) => ({ id: String(b._id), status: b.status, reviewKey: b.reviewKey, date: b.slot?.date, start: b.slot && fromMin(b.slot.startMin), end: b.slot && fromMin(b.slot.endMin) })),
    });
  }

  // Aggregation pipelines do NOT cast strings to ObjectIds, so the scope is expressed with real ObjectIds here.
  const aggScope = u.role === "hod" ? {} : u.role === "coordinator" ? { section: { $in: u.sections.map((id) => new mongoose.Types.ObjectId(id)) } } : { guide: u._id };
  const summary = await summarizeScope(u, { $and: [aggScope, { status: "active" }] });
  const scope = await requestScope(u);
  Object.assign(out, {
    teamCount: summary.teamCount,
    teamsByCurrentReview: summary.teamsByCurrentReview,
    teamsWithoutMilestoneRecord: summary.teamsWithoutMilestoneRecord,
    reportsApproved: summary.reportsApproved,
    awaitingGuideReview: summary.awaitingGuideReview,
    contributionsPending: summary.contributionsPending,
    pendingBookings: await BookingRequest.countDocuments({ ...scope, status: "pending" }),
  });

  if (u.role === "guide") {
    out.awaitingCorrection = summary.awaitingCorrection;
    const upcoming = await BookingRequest.find({ guide: u._id, status: "approved" }).populate("slot", "date startMin endMin").populate("team", "teamId").lean();
    out.upcomingSessions = upcoming.filter((b) => b.slot && b.slot.date >= today).sort((a, b) => (a.slot.date + a.slot.startMin).localeCompare(b.slot.date + b.slot.startMin)).slice(0, 8).map((b) => ({ id: String(b._id), team: b.team.teamId, date: b.slot.date, start: fromMin(b.slot.startMin), end: fromMin(b.slot.endMin), reviewKey: b.reviewKey }));
  } else {
    out.studentCount = await User.countDocuments({ role: "student", isActive: true, ...(u.role === "hod" ? {} : { section: { $in: u.sections } }) });
    out.sections = summary.sections;
    out.bookingSlotsAvailable = await BookingSlot.countDocuments({ status: "available", date: { $gte: today }, ...(u.role === "hod" ? {} : { section: { $in: u.sections } }) });
    if (u.role === "hod") out.guideCount = await User.countDocuments({ role: "guide", isActive: true });
  }
  res.json(out);
}));

export default router;
