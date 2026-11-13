import BookingRequest from "../../models/BookingRequest.js";
import BookingSlot from "../../models/BookingSlot.js";
import ReviewConfig from "../../models/ReviewConfig.js";
import Section from "../../models/Section.js";
import Team from "../../models/Team.js";
import User from "../../models/User.js";
import { forbidden, badRequest, conflict, notFound } from "../../shared/errors.js";
import { getSettings, effectiveBookingPolicy } from "../../shared/settings.js";
import { eachDate, fromMin, overlaps, slotInstant, toMin, todayStr, weekdayOf } from "../../shared/time.js";
import { Validator } from "../../shared/validate.js";

export const MAX_RANGE_DAYS = 62;
export const MAX_SLOTS_PER_REQUEST = 500;

export async function policyForSection(sectionId) {
  const [settings, section] = await Promise.all([getSettings(), sectionId ? Section.findById(sectionId).lean() : null]);
  return { settings, policy: effectiveBookingPolicy(settings, section), section };
}

export async function assertBookingEnabled(sectionId) {
  const ctx = await policyForSection(sectionId);
  if (!ctx.policy.enabled) throw forbidden("Slot booking is currently disabled. Progress updates and report submission are not affected.");
  return ctx;
}

export const shapeSlot = (s, { showTeam = true, mine = false } = {}) => ({
  id: String(s._id),
  guide: s.guide?.name ? { id: String(s.guide._id), name: s.guide.name } : { id: String(s.guide) },
  section: s.section?.name ? { id: String(s.section._id), name: s.section.name } : s.section ? { id: String(s.section) } : null,
  reviewKey: s.reviewKey,
  date: s.date,
  start: fromMin(s.startMin),
  end: fromMin(s.endMin),
  status: s.status,
  disabledReason: s.disabledReason || null,
  bookedTeam: showTeam && s.bookedTeam ? (s.bookedTeam.teamId ? { id: String(s.bookedTeam._id), teamId: s.bookedTeam.teamId } : { id: String(s.bookedTeam) }) : null,
  isMine: mine,
});

/** Expands a manual entry or a date/time-range configuration into candidate slots (nothing is saved). */
export function expandSlots(input, policy) {
  const v = new Validator(input);
  const mode = v.oneOf("mode", ["manual", "range"], { required: true });
  const reviewKey = v.string("reviewKey", { required: true, max: 41 });
  v.done();
  const out = [];
  const checkDuration = (d) => {
    if (d < policy.minDurationMinutes || d > policy.maxDurationMinutes) throw badRequest(`Slot duration must be between ${policy.minDurationMinutes} and ${policy.maxDurationMinutes} minutes`);
  };
  if (mode === "manual") {
    const mv = new Validator(input);
    const date = mv.date("date", { required: true });
    const start = toMin(mv.string("start", { required: true }));
    const end = toMin(mv.string("end", { required: true }));
    mv.done();
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) throw badRequest("End time must be after start time", { end: "End time must be after start time" });
    checkDuration(end - start);
    out.push({ date, startMin: start, endMin: end });
  } else {
    const rv = new Validator(input);
    const dateFrom = rv.date("dateFrom", { required: true });
    const dateTo = rv.date("dateTo", { required: true });
    const duration = rv.int("durationMinutes", { required: true, min: 5, max: 600 });
    const gap = rv.int("gapMinutes", { min: 0, max: 120 }) ?? 0;
    const weekdays = rv.array("weekdays", { max: 7 }) || [1, 2, 3, 4, 5];
    const windows = rv.array("windows", { required: true, max: 6 });
    rv.done();
    if (dateTo < dateFrom) throw badRequest("The end date is before the start date", { dateTo: "End date must not be before start date" });
    checkDuration(duration);
    const days = eachDate(dateFrom, dateTo);
    if (days.length > MAX_RANGE_DAYS) throw badRequest(`Choose a range of at most ${MAX_RANGE_DAYS} days`);
    if (weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw badRequest("Weekdays must be numbers 0 (Sunday) to 6 (Saturday)");
    const wins = windows.map((w) => ({ s: toMin(w?.start), e: toMin(w?.end) }));
    if (wins.some((w) => Number.isNaN(w.s) || Number.isNaN(w.e) || w.e <= w.s)) throw badRequest("Each time window needs a valid start and a later end", { windows: "Check the time windows" });
    for (let i = 0; i < wins.length; i++) for (let j = i + 1; j < wins.length; j++) if (overlaps(wins[i].s, wins[i].e, wins[j].s, wins[j].e)) throw badRequest("Time windows must not overlap", { windows: "Time windows overlap" });
    for (const date of days) {
      if (!weekdays.includes(weekdayOf(date))) continue;
      for (const w of wins) for (let t = w.s; t + duration <= w.e; t += duration + gap) out.push({ date, startMin: t, endMin: t + duration });
    }
    if (!out.length) throw badRequest("These settings produce no slots. Check the days, windows and duration.");
    if (out.length > MAX_SLOTS_PER_REQUEST) throw badRequest(`This would create ${out.length} slots; the limit is ${MAX_SLOTS_PER_REQUEST} at a time`);
  }
  return { reviewKey, candidates: out };
}

/** Marks each candidate ok / past / duplicate / overlap against the guide's calendar. */
export async function classifyCandidates(guideId, candidates, settings) {
  const dates = [...new Set(candidates.map((c) => c.date))];
  const existing = await BookingSlot.find({ guide: guideId, date: { $in: dates } }, "date startMin endMin").lean();
  const now = Date.now();
  const tz = settings.college.timezoneOffsetMinutes;
  const today = todayStr(tz);
  return candidates.map((c) => {
    let state = "ok";
    if (c.date < today || slotInstant(c.date, c.startMin, tz).getTime() <= now) state = "past";
    else {
      const same = existing.filter((e) => e.date === c.date);
      if (same.some((e) => e.startMin === c.startMin)) state = "duplicate";
      else if (same.some((e) => overlaps(c.startMin, c.endMin, e.startMin, e.endMin))) state = "overlap";
    }
    return { ...c, state };
  });
}

/** Resolves who the slots are for and checks the actor may create them. */
export async function resolveSlotOwner(user, body, settings, policy) {
  const v = new Validator(body);
  const guideInput = v.id("guide");
  const sectionInput = v.id("section");
  v.done();
  let guideId;
  let sectionId = sectionInput || null;
  if (user.role === "guide") {
    if (!policy.allowGuideSlotCreation) throw forbidden("Guides cannot create their own slots under the current booking policy");
    guideId = user.id;
    if (sectionId && !(await Team.exists({ guide: user._id, section: sectionId, status: "active" }))) throw forbidden("You have no teams in that section");
  } else {
    if (!guideInput) throw badRequest("Select a guide", { guide: "Select a guide" });
    guideId = guideInput;
    if (user.role === "coordinator") {
      if (!sectionId || !user.sections.includes(sectionId)) throw forbidden("Choose one of your assigned sections");
      if (!(await Team.exists({ guide: guideId, section: sectionId, status: "active" }))) throw forbidden("That guide has no teams in your section");
    }
    if (!(await User.exists({ _id: guideId, role: "guide", isActive: true }))) throw badRequest("Select an active guide", { guide: "Select an active guide" });
  }
  return { guideId, sectionId };
}

export async function assertReviewExists(reviewKey, sectionId) {
  const exists = await ReviewConfig.exists({ key: reviewKey, archivedAt: null, $or: [{ section: null }, ...(sectionId ? [{ section: sectionId }] : [])] });
  if (!exists) throw badRequest("Unknown review session", { reviewKey: "Choose an existing review" });
}

/* ------------------------------------------------------------------ */
/* Requests                                                            */
/* ------------------------------------------------------------------ */

async function releaseSlot(slotId, teamId) {
  await BookingSlot.updateOne({ _id: slotId, ...(teamId ? { bookedTeam: teamId } : {}), status: { $in: ["pending", "booked"] } }, { $set: { status: "available", bookedTeam: null } });
}

export async function createRequest({ user, slotId }) {
  if (!user.team) throw badRequest("You are not part of a team yet");
  const team = await Team.findById(user.team);
  if (!team || team.status !== "active") throw conflict("Your team is not active");
  const { settings, policy } = await assertBookingEnabled(team.section);
  if (policy.requestBy === "leader" && String(team.leader) !== user.id) throw forbidden("Only the team leader can request slots under the current policy");

  const slot = await BookingSlot.findById(slotId).lean();
  if (!slot) throw notFound("Slot not found");
  if (String(slot.guide) !== String(team.guide)) throw forbidden("That slot belongs to a different guide");
  if (slot.section && String(slot.section) !== String(team.section)) throw forbidden("That slot is reserved for another section");
  const tz = settings.college.timezoneOffsetMinutes;
  const cutoff = slotInstant(slot.date, slot.startMin, tz).getTime() - policy.cutoffHoursBeforeSlot * 3600000;
  if (Date.now() >= cutoff) throw conflict(policy.cutoffHoursBeforeSlot ? `Requests close ${policy.cutoffHoursBeforeSlot} hour(s) before the slot starts` : "This slot has already started");

  // The team must not hold overlapping slots for another review.
  const mine = await BookingRequest.find({ team: team._id, active: true }, "slot").lean();
  if (mine.length) {
    const held = await BookingSlot.find({ _id: { $in: mine.map((m) => m.slot) }, date: slot.date }, "startMin endMin").lean();
    if (held.some((h) => overlaps(slot.startMin, slot.endMin, h.startMin, h.endMin))) throw conflict("Your team already has another booking at that time");
  }

  // 1) atomically claim the slot; only one caller can flip available -> pending
  const claimed = await BookingSlot.findOneAndUpdate({ _id: slotId, status: "available" }, { $set: { status: "pending", bookedTeam: team._id } }, { new: true });
  if (!claimed) throw conflict("That slot is no longer available");
  // 2) create the request; unique partial indexes are the final guard
  try {
    const request = await BookingRequest.create({ slot: slotId, team: team._id, section: team.section, guide: team.guide, reviewKey: slot.reviewKey, requestedBy: user._id, history: [{ action: "requested", by: user._id, byName: user.name, toSlot: slotId }] });
    return { request, team, slot: claimed };
  } catch (err) {
    await releaseSlot(slotId, team._id);
    if (err?.code === 11000) throw conflict("Your team already has an active booking request for this review");
    throw err;
  }
}

async function loadRequest(id) {
  const r = await BookingRequest.findById(id);
  if (!r) throw notFound("Booking request not found");
  return r;
}

export async function approve({ user, id, override = false, reason }) {
  const r = await loadRequest(id);
  if (!override && String(r.guide) !== user.id) throw notFound("Booking request not found");
  const next = await BookingRequest.findOneAndUpdate({ _id: r._id, status: "pending" }, { $set: { status: "approved", decidedBy: user._id, decidedAt: new Date(), ...(override ? { overridden: true, decisionReason: reason } : {}) }, $push: { history: { action: override ? "override-approve" : "approve", by: user._id, byName: user.name, reason } } }, { new: true });
  if (!next) throw conflict("Only pending requests can be approved");
  await BookingSlot.updateOne({ _id: r.slot }, { $set: { status: "booked", bookedTeam: r.team } });
  return { before: r, after: next };
}

export async function reject({ user, id, reason, override = false }) {
  const r = await loadRequest(id);
  if (!override && String(r.guide) !== user.id) throw notFound("Booking request not found");
  const next = await BookingRequest.findOneAndUpdate({ _id: r._id, status: "pending" }, { $set: { status: "rejected", active: false, decidedBy: user._id, decidedAt: new Date(), decisionReason: reason, ...(override ? { overridden: true } : {}) }, $push: { history: { action: override ? "override-reject" : "reject", by: user._id, byName: user.name, reason } } }, { new: true });
  if (!next) throw conflict("Only pending requests can be rejected");
  await releaseSlot(r.slot, r.team);
  return { before: r, after: next };
}

/** Students may cancel their team's pending request; the assigned guide may also cancel an approved one. */
export async function cancel({ user, id, reason, override = false }) {
  const r = await loadRequest(id);
  const isGuide = String(r.guide) === user.id;
  const isMember = user.role === "student" && user.team && String(r.team) === user.team;
  if (!override && !isGuide && !isMember) throw notFound("Booking request not found");
  const allowed = override || isGuide ? ["pending", "approved"] : ["pending"];
  if ((isGuide || override) && r.status === "approved" && !reason) throw badRequest("Give a reason for cancelling an approved booking", { reason: "Reason is required" });
  const next = await BookingRequest.findOneAndUpdate({ _id: r._id, status: { $in: allowed } }, { $set: { status: "cancelled", active: false, decidedBy: user._id, decidedAt: new Date(), decisionReason: reason, ...(override ? { overridden: true } : {}) }, $push: { history: { action: override ? "override-cancel" : "cancel", by: user._id, byName: user.name, reason } } }, { new: true });
  if (!next) throw conflict(isMember && !isGuide && r.status === "approved" ? "An approved booking can only be cancelled by your guide" : "This request can no longer be cancelled");
  await releaseSlot(r.slot, r.team);
  return { before: r, after: next };
}

/** Coordinator/HOD moves a team to another free slot of the same guide and review. */
export async function reassign({ user, id, slotId, reason }) {
  const r = await loadRequest(id);
  if (!["pending", "approved"].includes(r.status)) throw conflict("Only pending or approved bookings can be moved");
  const target = await BookingSlot.findById(slotId).lean();
  if (!target) throw notFound("Target slot not found");
  if (String(target.guide) !== String(r.guide) || target.reviewKey !== r.reviewKey) throw badRequest("The new slot must belong to the same guide and review session");
  if (target.section && String(target.section) !== String(r.section)) throw badRequest("The new slot is reserved for another section");
  const claimed = await BookingSlot.findOneAndUpdate({ _id: slotId, status: "available" }, { $set: { status: r.status === "approved" ? "booked" : "pending", bookedTeam: r.team } }, { new: true });
  if (!claimed) throw conflict("The new slot is not available");
  const oldSlot = r.slot;
  try {
    r.slot = slotId;
    r.overridden = true;
    r.decisionReason = reason;
    r.history.push({ action: "override-reassign", by: user._id, byName: user.name, reason, fromSlot: oldSlot, toSlot: slotId });
    await r.save();
  } catch (err) {
    await releaseSlot(slotId, r.team);
    throw err;
  }
  await releaseSlot(oldSlot, r.team);
  return { before: { slot: String(oldSlot), status: r.status }, after: { slot: String(slotId), status: r.status }, request: r };
}
