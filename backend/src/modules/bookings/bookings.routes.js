import { Router } from "express";
import BookingRequest from "../../models/BookingRequest.js";
import BookingSlot from "../../models/BookingSlot.js";
import Section from "../../models/Section.js";
import Settings from "../../models/Settings.js";
import Team from "../../models/Team.js";
import User from "../../models/User.js";
import { audit } from "../../shared/audit.js";
import { authorize, protect } from "../../shared/auth.js";
import { asyncHandler, badRequest, conflict, forbidden, notFound } from "../../shared/errors.js";
import { notify } from "../../shared/notify.js";
import { inCoordinatorScope } from "../../shared/scope.js";
import { getSettings } from "../../shared/settings.js";
import { fromMin, todayStr } from "../../shared/time.js";
import { Validator, pageParams, parseId } from "../../shared/validate.js";
import * as svc from "./bookings.service.js";

const router = Router();
router.use(protect);

/* -------------------------------- policy -------------------------------- */

router.get("/policy", asyncHandler(async (req, res) => {
  let sectionId = req.query.section ? parseId(req.query.section, "section") : req.user.section || req.user.sections?.[0] || null;
  if (req.user.role === "coordinator" && sectionId && !req.user.sections.includes(sectionId)) throw forbidden();
  const { settings, policy, section } = await svc.policyForSection(sectionId);
  res.json({ policy, college: settings.booking, sectionOverride: section?.booking || null, sectionId });
}));

router.patch("/policy", authorize("hod", "coordinator"), asyncHandler(async (req, res) => {
  const v = new Validator(req.body);
  const sectionId = v.id("section");
  const enabled = v.bool("enabled");
  const requestBy = v.oneOf("requestBy", ["any_member", "leader"]);
  const cutoff = v.int("cutoffHoursBeforeSlot", { min: 0, max: 720 });
  const minD = v.int("minDurationMinutes", { min: 5, max: 600 });
  const maxD = v.int("maxDurationMinutes", { min: 5, max: 600 });
  const allowGuide = v.bool("allowGuideSlotCreation");
  v.done();
  const settings = await getSettings();

  if (!sectionId) {
    if (req.user.role !== "hod") throw forbidden("Only the HOD can change the college-wide booking policy");
    const set = {};
    if (enabled !== undefined) set["booking.enabled"] = enabled;
    if (requestBy) set["booking.requestBy"] = requestBy;
    if (cutoff !== undefined) set["booking.cutoffHoursBeforeSlot"] = cutoff;
    if (minD !== undefined) set["booking.minDurationMinutes"] = minD;
    if (maxD !== undefined) set["booking.maxDurationMinutes"] = maxD;
    if (allowGuide !== undefined) set["booking.allowGuideSlotCreation"] = allowGuide;
    if ((maxD ?? settings.booking.maxDurationMinutes) < (minD ?? settings.booking.minDurationMinutes)) throw badRequest("Maximum duration cannot be below the minimum");
    await Settings.updateOne({ key: "default" }, { $set: set });
    const after = (await getSettings()).booking;
    await audit(req.user, { action: enabled === undefined ? "UPDATE" : enabled ? "ENABLE" : "DISABLE", entity: "BookingPolicy", entityName: "College booking policy", before: settings.booking, after, ip: req.ip });
    return res.json({ college: after });
  }

  if (!inCoordinatorScope(req.user, sectionId)) throw forbidden("You can only configure booking for your assigned sections");
  const section = await Section.findById(sectionId);
  if (!section) throw notFound("Section not found");
  if (enabled === true && !settings.booking.enabled) throw conflict("Booking is disabled college-wide by the HOD, so it cannot be enabled for a section");
  if (cutoff !== undefined && cutoff < settings.booking.cutoffHoursBeforeSlot) throw badRequest(`The cut-off cannot be shorter than the college policy (${settings.booking.cutoffHoursBeforeSlot} h)`);
  const before = section.booking.toObject();
  if (enabled !== undefined) section.booking.enabled = enabled;
  if (requestBy) section.booking.requestBy = requestBy;
  if (cutoff !== undefined) section.booking.cutoffHoursBeforeSlot = cutoff;
  await section.save();
  await audit(req.user, { action: enabled === undefined ? "UPDATE" : enabled ? "ENABLE" : "DISABLE", entity: "BookingPolicy", entityId: section._id, entityName: `Section ${section.name} booking policy`, before, after: section.booking.toObject(), ip: req.ip });
  res.json({ sectionOverride: section.booking });
}));

/* -------------------------------- slots --------------------------------- */

async function slotScopeFilter(user) {
  if (user.role === "hod") return {};
  if (user.role === "guide") return { guide: user._id };
  if (user.role === "coordinator") {
    const guides = await Team.distinct("guide", { section: { $in: user.sections }, status: "active" });
    return { $or: [{ section: { $in: user.sections } }, { section: null, guide: { $in: guides } }] };
  }
  const team = user.team ? await Team.findById(user.team, "guide section").lean() : null;
  if (!team) return { _id: null };
  return { guide: team.guide, $or: [{ section: null }, { section: team.section }] };
}

router.get("/slots", asyncHandler(async (req, res) => {
  const q = req.query;
  const and = [await slotScopeFilter(req.user)];
  const settings = await getSettings();
  const from = q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from) ? q.from : req.user.role === "student" ? todayStr(settings.college.timezoneOffsetMinutes) : null;
  if (from) and.push({ date: { $gte: from } });
  if (q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to)) and.push({ date: { $lte: q.to } });
  if (q.guide && req.user.role !== "guide" && req.user.role !== "student") and.push({ guide: parseId(q.guide, "guide") });
  if (q.section && !["student"].includes(req.user.role)) and.push({ section: parseId(q.section, "section") });
  if (q.reviewKey) and.push({ reviewKey: String(q.reviewKey).slice(0, 41) });
  if (q.status) and.push({ status: String(q.status) });
  const { page, limit, skip } = pageParams(q, { defaultLimit: 100, maxLimit: 200 });
  const filter = { $and: and };
  const [slots, total] = await Promise.all([
    BookingSlot.find(filter).populate("guide", "name").populate("section", "name").populate("bookedTeam", "teamId").sort({ date: 1, startMin: 1, _id: 1 }).skip(skip).limit(limit).lean(),
    BookingSlot.countDocuments(filter),
  ]);
  const isStudent = req.user.role === "student";
  res.json({ total, page, limit, slots: slots.map((s) => svc.shapeSlot(s, { showTeam: !isStudent || String(s.bookedTeam?._id) === req.user.team, mine: isStudent && String(s.bookedTeam?._id) === req.user.team })) });
}));

async function prepare(req) {
  const owner0 = await svc.policyForSection(req.body?.section || null);
  const { guideId, sectionId } = await svc.resolveSlotOwner(req.user, req.body, owner0.settings, owner0.policy);
  const ctx = await svc.assertBookingEnabled(sectionId);
  const { reviewKey, candidates } = svc.expandSlots(req.body, ctx.policy);
  await svc.assertReviewExists(reviewKey, sectionId);
  const classified = await svc.classifyCandidates(guideId, candidates, ctx.settings);
  return { guideId, sectionId, reviewKey, classified };
}
const summarize = (c) => ({ total: c.length, ok: c.filter((x) => x.state === "ok").length, past: c.filter((x) => x.state === "past").length, duplicate: c.filter((x) => x.state === "duplicate").length, overlap: c.filter((x) => x.state === "overlap").length });
const view = (c) => c.map((x) => ({ date: x.date, start: fromMin(x.startMin), end: fromMin(x.endMin), state: x.state }));

router.post("/slots/preview", authorize("hod", "coordinator", "guide"), asyncHandler(async (req, res) => {
  const p = await prepare(req);
  res.json({ summary: summarize(p.classified), slots: view(p.classified) });
}));

router.post("/slots", authorize("hod", "coordinator", "guide"), asyncHandler(async (req, res) => {
  const p = await prepare(req);
  const skip = req.body?.skipConflicts === true;
  const bad = p.classified.filter((x) => x.state !== "ok");
  if (bad.length && !skip) throw conflict("Some slots conflict with existing slots or the calendar. Review the preview or choose to skip them.", { summary: summarize(p.classified), slots: view(p.classified) });
  const ok = p.classified.filter((x) => x.state === "ok");
  if (!ok.length) throw conflict("None of these slots can be created", { summary: summarize(p.classified) });
  let created = 0;
  try {
    const inserted = await BookingSlot.insertMany(ok.map((c) => ({ guide: p.guideId, section: p.sectionId, reviewKey: p.reviewKey, date: c.date, startMin: c.startMin, endMin: c.endMin, createdBy: req.user._id })), { ordered: false });
    created = inserted.length;
  } catch (err) {
    if (err?.code === 11000 || err?.writeErrors) created = err.insertedDocs?.length ?? err.result?.insertedCount ?? 0; // lost a race with another creator; remaining are duplicates
    else throw err;
  }
  await audit(req.user, { action: "CREATE", entity: "BookingSlot", entityName: `${created} slot(s) for ${p.reviewKey}`, after: { guide: p.guideId, section: p.sectionId, reviewKey: p.reviewKey, created, skipped: p.classified.length - created }, ip: req.ip });
  res.status(201).json({ created, skipped: p.classified.length - created, summary: summarize(p.classified) });
}));

async function loadManageableSlot(req) {
  const slot = await BookingSlot.findOne({ $and: [{ _id: parseId(req.params.id) }, await slotScopeFilter(req.user)] });
  if (!slot || req.user.role === "student") throw notFound("Slot not found");
  if (req.user.role === "coordinator" && !(slot.section ? req.user.sections.includes(String(slot.section)) : true)) throw forbidden();
  return slot;
}

router.patch("/slots/:id", authorize("hod", "coordinator", "guide"), asyncHandler(async (req, res) => {
  const slot = await loadManageableSlot(req);
  const v = new Validator(req.body);
  const action = v.oneOf("action", ["disable", "enable"], { required: true });
  const reason = v.string("reason", { max: 300 });
  v.done();
  const before = { status: slot.status };
  if (action === "disable") {
    if (slot.status !== "available") throw conflict("This slot has a booking. Cancel the booking first.");
    slot.status = "disabled";
    slot.disabledReason = reason || "Disabled";
  } else {
    if (slot.status !== "disabled") throw conflict("Slot is not disabled");
    slot.status = "available";
    slot.disabledReason = undefined;
  }
  await slot.save();
  await audit(req.user, { action: action.toUpperCase(), entity: "BookingSlot", entityId: slot._id, entityName: `${slot.date} ${fromMin(slot.startMin)}`, before, after: { status: slot.status }, reason, ip: req.ip });
  res.json({ slot: svc.shapeSlot(slot.toObject()) });
}));

router.delete("/slots/:id", authorize("hod", "coordinator", "guide"), asyncHandler(async (req, res) => {
  const slot = await loadManageableSlot(req);
  if (slot.status !== "available" || (await BookingRequest.exists({ slot: slot._id }))) throw conflict("This slot has booking history, so it can only be disabled, not deleted.");
  await BookingSlot.deleteOne({ _id: slot._id, status: "available" });
  await audit(req.user, { action: "DELETE", entity: "BookingSlot", entityId: slot._id, entityName: `${slot.date} ${fromMin(slot.startMin)}`, ip: req.ip });
  res.json({ message: "Slot removed" });
}));

/* ------------------------------- requests -------------------------------- */

const shapeRequest = (r) => ({
  id: String(r._id), status: r.status, reviewKey: r.reviewKey, overridden: r.overridden, decisionReason: r.decisionReason || null, decidedAt: r.decidedAt, createdAt: r.createdAt,
  team: r.team?.teamId ? { id: String(r.team._id), teamId: r.team.teamId, projectTitle: r.team.projectTitle } : { id: String(r.team) },
  guide: r.guide?.name ? { id: String(r.guide._id), name: r.guide.name } : { id: String(r.guide) },
  requestedBy: r.requestedBy?.name ? { id: String(r.requestedBy._id), name: r.requestedBy.name } : { id: String(r.requestedBy) },
  slot: r.slot?.date ? { id: String(r.slot._id), date: r.slot.date, start: fromMin(r.slot.startMin), end: fromMin(r.slot.endMin), status: r.slot.status } : { id: String(r.slot) },
  history: (r.history || []).map((h) => ({ action: h.action, by: h.byName, reason: h.reason, at: h.at })),
});

const populateReq = (q) => q.populate("team", "teamId projectTitle").populate("guide", "name").populate("requestedBy", "name").populate("slot", "date startMin endMin status");

/** Which booking requests a user may see, expressed directly on the request (no team-id list is loaded). */
async function requestScopeFilter(user) {
  if (user.role === "hod") return {};
  if (user.role === "coordinator") return { section: { $in: user.sections } };
  if (user.role === "guide") return { team: { $in: await Team.distinct("_id", { guide: user._id }) } };
  return user.team ? { team: user.team } : { _id: null };
}

router.get("/requests", asyncHandler(async (req, res) => {
  const { page, limit, skip } = pageParams(req.query, { defaultLimit: 50, maxLimit: 200 });
  const and = [await requestScopeFilter(req.user)];
  if (req.query.status) and.push({ status: String(req.query.status) });
  if (req.query.reviewKey) and.push({ reviewKey: String(req.query.reviewKey) });
  if (req.query.team) and.push({ team: parseId(req.query.team, "team") });
  const filter = { $and: and };
  const [list, total] = await Promise.all([
    populateReq(BookingRequest.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit)).lean(),
    BookingRequest.countDocuments(filter),
  ]);
  res.json({ total, page, limit, requests: list.map(shapeRequest) });
}));

async function afterChange(req, kind, { before, after }, { teamId, guideId, reason, entityId }) {
  const members = await User.find({ team: teamId, isActive: true }, "_id").lean();
  const text = { requested: "A booking request was submitted.", approve: "Your review slot booking was approved.", reject: `Your booking request was declined. ${reason || ""}`, cancel: `A booking was cancelled. ${reason || ""}`, override: `A coordinator/HOD changed your booking. Reason: ${reason}` }[kind];
  await notify([...members.map((m) => m._id), ...(kind === "requested" || kind === "override" ? [guideId] : [])], { type: `booking_${kind}`, title: "Review slot booking", message: text.trim(), link: "/bookings", ...(kind === "override" ? {} : { dedupeKey: `booking_${kind}:${entityId}` }) }, { email: true });
  if (kind === "override") await audit(req.user, { action: "OVERRIDE", entity: "BookingRequest", entityId, entityName: "Booking override", before, after, reason, ip: req.ip });
}

router.post("/requests", authorize("student"), asyncHandler(async (req, res) => {
  const v = new Validator(req.body);
  const slotId = v.id("slotId", { required: true });
  v.done();
  const { request, team } = await svc.createRequest({ user: req.user, slotId });
  await notify([team.guide], { type: "booking_requested", title: "New slot request", message: `${team.teamId} requested a review slot.`, link: "/bookings", dedupeKey: `booking_requested:${request._id}` }, { email: true });
  res.status(201).json({ request: shapeRequest((await populateReq(BookingRequest.findById(request._id)).lean())) });
}));

const act = (fn, kind) => asyncHandler(async (req, res) => {
  const v = new Validator(req.body);
  const reason = v.string("reason", { max: 500, min: kind === "reject" ? 3 : 0, required: kind === "reject" });
  v.done();
  const result = await fn({ user: req.user, id: parseId(req.params.id), reason });
  await afterChange(req, kind, result, { teamId: result.after.team, guideId: result.after.guide, reason, entityId: result.after._id });
  res.json({ request: shapeRequest(await populateReq(BookingRequest.findById(result.after._id)).lean()) });
});

router.post("/requests/:id/approve", authorize("guide"), act(svc.approve, "approve"));
router.post("/requests/:id/reject", authorize("guide"), act(svc.reject, "reject"));
router.post("/requests/:id/cancel", authorize("student", "guide"), act(svc.cancel, "cancel"));

/** Auditable override by the Coordinator of the team's section or the HOD. Always needs a reason. */
router.post("/requests/:id/override", authorize("hod", "coordinator"), asyncHandler(async (req, res) => {
  const v = new Validator(req.body);
  const action = v.oneOf("action", ["approve", "reject", "cancel", "reassign"], { required: true });
  const reason = v.string("reason", { required: true, min: 5, max: 500 });
  const slotId = v.id("slotId", { required: action === "reassign" });
  v.done();
  const r = await BookingRequest.findById(parseId(req.params.id));
  if (!r || !inCoordinatorScope(req.user, r.section)) throw notFound("Booking request not found");
  const args = { user: req.user, id: r._id, reason, override: true };
  let result;
  if (action === "approve") result = await svc.approve(args);
  else if (action === "reject") result = await svc.reject(args);
  else if (action === "cancel") result = await svc.cancel(args);
  else result = await svc.reassign({ user: req.user, id: r._id, slotId, reason });
  const snap = (x) => (x.toObject ? { status: x.status, slot: String(x.slot) } : x);
  await afterChange(req, "override", { before: snap(result.before), after: snap(result.after) }, { teamId: r.team, guideId: r.guide, reason, entityId: r._id });
  res.json({ request: shapeRequest(await populateReq(BookingRequest.findById(r._id)).lean()) });
}));

export default router;
