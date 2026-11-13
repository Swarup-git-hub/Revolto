import fs from "node:fs";
import { Router } from "express";
import ReviewConfig from "../../models/ReviewConfig.js";
import Contribution from "../../models/Contribution.js";
import Submission from "../../models/Submission.js";
import Team from "../../models/Team.js";
import { audit } from "../../shared/audit.js";
import { authorize, protect } from "../../shared/auth.js";
import { asyncHandler, badRequest, conflict, forbidden, notFound } from "../../shared/errors.js";
import { loadScopedTeam, requireTeamLeader } from "../../shared/scope.js";
import { attachmentUpload, resolveStoredFile } from "../../shared/upload.js";
import { Validator, isObjectId, parseId } from "../../shared/validate.js";
import { computeProgress } from "./progress.service.js";
import { configHasHistory, getEffectiveReview, getEffectiveReviews, parseConfigInput } from "./reviewConfig.service.js";
import { reviewContribution, reviewSubmission, submitContribution, submitTeamReview } from "./submissions.service.js";

const router = Router();
router.use(protect);

/* ------------------------------------------------------------------ */
/* Review configuration                                                */
/* ------------------------------------------------------------------ */

const shapeConfig = (c) => ({
  id: String(c._id), key: c.key, name: c.name, order: c.order, type: c.type, section: c.section ? String(c.section) : null,
  deadline: c.deadline, fields: c.fields, milestones: c.milestones || [], individualContributions: c.individualContributions,
  upload: c.upload, archivedAt: c.archivedAt,
});

function assertCanEditConfig(user, sectionId) {
  if (user.role === "hod") return;
  if (user.role === "coordinator" && sectionId && user.sections.includes(String(sectionId))) return;
  throw forbidden(user.role === "coordinator" ? "Coordinators can only configure reviews for their own sections" : undefined);
}

router.get("/reviews/config", asyncHandler(async (req, res) => {
  const u = req.user;
  const raw = req.query.raw === "true" && ["hod", "coordinator"].includes(u.role);
  if (raw) {
    const filter = u.role === "hod" ? {} : { $or: [{ section: null }, { section: { $in: u.sections } }] };
    if (req.query.includeArchived !== "true") filter.archivedAt = null;
    const all = await ReviewConfig.find(filter).sort({ order: 1, section: 1 }).lean();
    return res.json({ reviews: all.map(shapeConfig) });
  }
  let sectionId = req.query.section ? parseId(req.query.section, "section") : null;
  if (u.role === "student") sectionId = u.section;
  else if (u.role === "guide") {
    const sections = (await Team.distinct("section", { guide: u._id })).map(String);
    if (sectionId && !sections.includes(sectionId)) throw forbidden();
    sectionId ??= sections[0] || null;
  } else if (u.role === "coordinator") {
    if (sectionId && !u.sections.includes(sectionId)) throw forbidden();
    sectionId ??= u.sections[0] || null;
  }
  res.json({ reviews: (await getEffectiveReviews(sectionId)).map(shapeConfig) });
}));

router.post("/reviews/config", authorize("hod", "coordinator"), asyncHandler(async (req, res) => {
  const v = new Validator(req.body);
  const sectionId = req.body?.section ? v.id("section") : null;
  v.done();
  assertCanEditConfig(req.user, sectionId);
  const data = parseConfigInput(req.body, { creating: true });
  if (await ReviewConfig.exists({ key: data.key, section: sectionId, archivedAt: null })) throw conflict("A review with that key already exists in this scope", { key: "Already in use" });
  data.fields ??= [];
  if (data.type === "progress") data.milestones ??= [];
  const cfg = await ReviewConfig.create({ ...data, section: sectionId, createdBy: req.user._id });
  await audit(req.user, { action: "CREATE", entity: "ReviewConfig", entityId: cfg._id, entityName: cfg.name, after: shapeConfig(cfg), ip: req.ip });
  res.status(201).json({ review: shapeConfig(cfg) });
}));

/** Copy a college-wide review into a section so a Coordinator can adjust it without touching the college default. */
router.post("/reviews/config/:id/override", authorize("hod", "coordinator"), asyncHandler(async (req, res) => {
  const base = await ReviewConfig.findOne({ _id: parseId(req.params.id), section: null, archivedAt: null }).lean();
  if (!base) throw notFound("College-wide review not found");
  const v = new Validator(req.body);
  const sectionId = v.id("section", { required: true });
  v.done();
  assertCanEditConfig(req.user, sectionId);
  if (await ReviewConfig.exists({ key: base.key, section: sectionId, archivedAt: null })) throw conflict("This section already has its own version of that review");
  const { _id, createdAt, updatedAt, __v, ...rest } = base;
  const cfg = await ReviewConfig.create({ ...rest, section: sectionId, createdBy: req.user._id });
  await audit(req.user, { action: "CREATE", entity: "ReviewConfig", entityId: cfg._id, entityName: `${cfg.name} (section override)`, ip: req.ip });
  res.status(201).json({ review: shapeConfig(cfg) });
}));

router.patch("/reviews/config/:id", authorize("hod", "coordinator"), asyncHandler(async (req, res) => {
  const cfg = await ReviewConfig.findOne({ _id: parseId(req.params.id), archivedAt: null });
  if (!cfg) throw notFound("Review not found");
  assertCanEditConfig(req.user, cfg.section);
  const hasHistory = await configHasHistory(cfg);
  const patch = parseConfigInput(req.body, { creating: false, existing: cfg.toObject(), hasHistory });
  const before = shapeConfig(cfg);
  Object.assign(cfg, patch);
  await cfg.save();
  await audit(req.user, { action: "UPDATE", entity: "ReviewConfig", entityId: cfg._id, entityName: cfg.name, before, after: shapeConfig(cfg), ip: req.ip });
  res.json({ review: shapeConfig(cfg) });
}));

/** Reviews with submissions are archived (hidden from new work, history preserved); unused ones are removed. */
router.delete("/reviews/config/:id", authorize("hod", "coordinator"), asyncHandler(async (req, res) => {
  const cfg = await ReviewConfig.findOne({ _id: parseId(req.params.id), archivedAt: null });
  if (!cfg) throw notFound("Review not found");
  assertCanEditConfig(req.user, cfg.section);
  const archived = await configHasHistory(cfg);
  if (archived) {
    cfg.archivedAt = new Date();
    await cfg.save();
  } else {
    await ReviewConfig.deleteOne({ _id: cfg._id });
  }
  await audit(req.user, { action: archived ? "ARCHIVE" : "DELETE", entity: "ReviewConfig", entityId: cfg._id, entityName: cfg.name, ip: req.ip });
  res.json({ archived, message: archived ? "This review has submissions, so it was archived instead of deleted." : "Review removed." });
}));

/* ------------------------------------------------------------------ */
/* Team submissions                                                    */
/* ------------------------------------------------------------------ */

const parseBody = (req) => {
  if (!req.is("multipart/form-data")) return req.body;
  try {
    return JSON.parse(req.body?.data || "{}");
  } catch {
    throw badRequest("The submission data is not valid JSON");
  }
};
const shapeSub = (s) => ({
  id: String(s._id), reviewKey: s.reviewKey, reviewType: s.reviewType, version: s.version, isLatest: s.isLatest, status: s.status,
  submittedBy: { id: String(s.submittedBy), name: s.submittedByName }, submittedAt: s.submittedAt, isLate: s.isLate, data: s.data,
  file: s.file ? { name: s.file.originalName, size: s.file.size, mimeType: s.file.mimeType } : null,
  reviewHistory: (s.reviewHistory || []).map((r) => ({ decision: r.decision, feedback: r.feedback, by: r.byName, at: r.at })),
});

router.get("/teams/:teamId/reviews/:reviewKey/submissions", asyncHandler(async (req, res) => {
  const team = await loadScopedTeam(req.user, req.params.teamId, "_id");
  const subs = await Submission.find({ team: team._id, reviewKey: req.params.reviewKey }).sort({ version: -1 }).lean();
  res.json({ submissions: subs.map(shapeSub) });
}));

router.post("/teams/:teamId/reviews/:reviewKey/submissions", authorize("student"), (req, res, next) => attachmentUpload(req, res, next), asyncHandler(async (req, res) => {
  const team = await loadScopedTeam(req.user, req.params.teamId);
  requireTeamLeader(req.user, team);
  const sub = await submitTeamReview({ user: req.user, team, reviewKey: req.params.reviewKey, rawData: parseBody(req), file: req.file });
  res.status(201).json({ submission: shapeSub(sub) });
}));

router.post("/submissions/:id/review", authorize("guide"), asyncHandler(async (req, res) => {
  const v = new Validator(req.body);
  const decision = v.oneOf("decision", ["under_review", "approved", "changes_required"], { required: true });
  const feedback = v.string("feedback", { max: 2000 });
  v.done();
  const sub = await reviewSubmission({ user: req.user, submissionId: parseId(req.params.id), decision, feedback });
  res.json({ submission: shapeSub(sub) });
}));

router.get("/submissions/:id/file", asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound("File not found");
  const sub = await Submission.findById(req.params.id, "team file").lean();
  if (!sub?.file) throw notFound("File not found");
  await loadScopedTeam(req.user, sub.team, "_id"); // role + ownership check
  const abs = resolveStoredFile(sub.file.storedName);
  if (!fs.existsSync(abs)) throw notFound("File is no longer available");
  res.setHeader("Content-Type", sub.file.mimeType || "application/octet-stream");
  res.setHeader("Content-Length", sub.file.size);
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(sub.file.originalName)}`);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox"); // never let an uploaded file execute in the browser
  fs.createReadStream(abs).pipe(res);
}));

/* ------------------------------------------------------------------ */
/* Individual contributions                                            */
/* ------------------------------------------------------------------ */

const shapeContribution = (c) => ({
  id: String(c._id), reviewKey: c.reviewKey, student: { id: String(c.student), name: c.studentName }, version: c.version, isLatest: c.isLatest,
  status: c.status, submittedAt: c.submittedAt, data: c.data,
  reviewHistory: (c.reviewHistory || []).map((r) => ({ decision: r.decision, feedback: r.feedback, by: r.byName, at: r.at })),
});

router.get("/teams/:teamId/reviews/:reviewKey/contributions", asyncHandler(async (req, res) => {
  const team = await loadScopedTeam(req.user, req.params.teamId, "_id");
  const filter = { team: team._id, reviewKey: req.params.reviewKey };
  if (req.query.latest === "true") filter.isLatest = true;
  const list = await Contribution.find(filter).sort({ studentName: 1, version: -1 }).lean();
  res.json({ contributions: list.map(shapeContribution) });
}));

router.post("/teams/:teamId/reviews/:reviewKey/contributions", authorize("student"), asyncHandler(async (req, res) => {
  const team = await loadScopedTeam(req.user, req.params.teamId);
  const c = await submitContribution({ user: req.user, team, reviewKey: req.params.reviewKey, rawData: req.body });
  res.status(201).json({ contribution: shapeContribution(c) });
}));

router.post("/contributions/:id/review", authorize("guide"), asyncHandler(async (req, res) => {
  const v = new Validator(req.body);
  const decision = v.oneOf("decision", ["acknowledged", "changes_required"], { required: true });
  const feedback = v.string("feedback", { max: 2000 });
  v.done();
  const c = await reviewContribution({ user: req.user, contributionId: parseId(req.params.id), decision, feedback });
  res.json({ contribution: shapeContribution(c) });
}));

/* ------------------------------------------------------------------ */
/* Guide work queue and cross-review comparison                        */
/* ------------------------------------------------------------------ */

router.get("/reviews/queue", authorize("guide"), asyncHandler(async (req, res) => {
  const teams = await Team.find({ guide: req.user._id, status: "active" }, "teamId projectTitle").lean();
  const byId = new Map(teams.map((t) => [String(t._id), t]));
  const ids = teams.map((t) => t._id);
  const [subs, contribs, waiting] = await Promise.all([
    Submission.find({ team: { $in: ids }, isLatest: true, status: { $in: ["submitted", "under_review"] } }).sort({ submittedAt: 1 }).lean(),
    Contribution.find({ team: { $in: ids }, isLatest: true, status: "pending_review" }).sort({ submittedAt: 1 }).lean(),
    Submission.find({ team: { $in: ids }, isLatest: true, status: "changes_required" }).sort({ submittedAt: 1 }).lean(),
  ]);
  const t = (id) => ({ id: String(id), teamId: byId.get(String(id))?.teamId, projectTitle: byId.get(String(id))?.projectTitle });
  res.json({
    submissions: subs.map((s) => ({ ...shapeSub(s), team: t(s.team) })),
    contributions: contribs.map((c) => ({ ...shapeContribution(c), team: t(c.team) })),
    awaitingCorrection: waiting.map((s) => ({ id: String(s._id), reviewKey: s.reviewKey, version: s.version, submittedAt: s.submittedAt, team: t(s.team) })),
  });
}));

/** Shows recorded data from two reviews side by side (e.g. Review 2 → Review 3). Nothing is inferred or filled in. */
router.get("/teams/:teamId/compare", asyncHandler(async (req, res) => {
  const team = await loadScopedTeam(req.user, req.params.teamId);
  const fromKey = String(req.query.from || "review-2");
  const toKey = String(req.query.to || "review-3");
  const side = async (key) => {
    const cfg = await getEffectiveReview(team.section, key);
    if (!cfg) return { review: null, submission: null };
    const sub = await Submission.findOne({ team: team._id, reviewKey: key, isLatest: true }).lean();
    return { review: { key: cfg.key, name: cfg.name, type: cfg.type, fields: cfg.fields, milestones: cfg.milestones }, submission: sub ? shapeSub(sub) : null };
  };
  const [from, to] = await Promise.all([side(fromKey), side(toKey)]);
  const progress = (await computeProgress([team.toObject()])).get(String(team._id));
  res.json({ from, to, milestones: progress.milestones, note: "Only recorded data is shown. Review 3 does not change Review 2 milestone statuses." });
}));

export default router;
