import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { buildWorld, futureDate, startApp } from "./helpers.js";
import AuditLog from "../src/models/AuditLog.js";
import { reconcileCounters } from "../src/shared/counters.js";
import BookingRequest from "../src/models/BookingRequest.js";
import BookingSlot from "../src/models/BookingSlot.js";
import Team from "../src/models/Team.js";
import User from "../src/models/User.js";

let app, w, hod, g1, g2, coordA, coordB, s1, s2;
before(async () => {
  app = await startApp("bookings");
  w = await buildWorld(app.url);
  [hod, g1, g2, coordA, coordB, s1, s2] = await Promise.all([w.users.hod, w.users.g1, w.users.g2, w.users.coordA, w.users.coordB, w.users.st[0], w.users.st[4]].map((u) => w.api(u)));
});
after(() => app.stop());

const manual = (o = {}) => ({ mode: "manual", reviewKey: "review-2", date: futureDate(3), start: "10:00", end: "10:30", ...o });
const range = (o = {}) => ({ mode: "range", reviewKey: "review-2", dateFrom: futureDate(3), dateTo: futureDate(9), weekdays: [0, 1, 2, 3, 4, 5, 6], windows: [{ start: "09:00", end: "11:00" }, { start: "14:00", end: "15:00" }], durationMinutes: 30, ...o });

test("slot generation: preview shows what would be created and saves nothing", async () => {
  const p = await g1.post("/bookings/slots/preview", range());
  assert.equal(p.status, 200);
  assert.equal(p.body.summary.total, 7 * 6, "7 days × (4 morning + 2 afternoon) slots");
  assert.equal(p.body.summary.ok, 42);
  assert.deepEqual(p.body.slots[0], { date: futureDate(3), start: "09:00", end: "09:30", state: "ok" });
  assert.equal(await BookingSlot.countDocuments(), 0);
});

test("slot validation: invalid ranges, durations, past dates, overlaps and duplicates are caught", async () => {
  assert.equal((await g1.post("/bookings/slots/preview", manual({ start: "11:00", end: "10:00" }))).status, 400);
  assert.equal((await g1.post("/bookings/slots/preview", manual({ start: "10:00", end: "10:05" }))).status, 400, "below min duration");
  assert.equal((await g1.post("/bookings/slots/preview", manual({ start: "08:00", end: "13:00" }))).status, 400, "above max duration");
  assert.equal((await g1.post("/bookings/slots/preview", range({ dateTo: "2020-01-01" }))).status, 400);
  assert.equal((await g1.post("/bookings/slots/preview", range({ windows: [{ start: "09:00", end: "11:00" }, { start: "10:30", end: "12:00" }] }))).status, 400, "overlapping windows");
  assert.equal((await g1.post("/bookings/slots/preview", manual({ reviewKey: "review-99" }))).status, 400, "unknown review");
  const past = await g1.post("/bookings/slots/preview", manual({ date: "2020-01-02" }));
  assert.equal(past.body.slots[0].state, "past");
  assert.equal((await g1.post("/bookings/slots", manual({ date: "2020-01-02" }))).status, 409, "past slot cannot be saved");

  assert.equal((await g1.post("/bookings/slots", manual())).status, 201);
  const dup = await g1.post("/bookings/slots", manual());
  assert.equal(dup.status, 409);
  assert.equal(dup.body.details.slots[0].state, "duplicate");
  const ov = await g1.post("/bookings/slots", manual({ start: "10:15", end: "10:45" }));
  assert.equal(ov.status, 409);
  assert.equal(ov.body.details.slots[0].state, "overlap", "guide conflict");
  const skip = await g1.post("/bookings/slots", { ...range({ dateFrom: futureDate(3), dateTo: futureDate(3), windows: [{ start: "10:00", end: "11:00" }] }), skipConflicts: true });
  assert.equal(skip.body.created, 1, "10:30–11:00 created; 10:00–10:30 duplicate skipped");
  assert.equal(skip.body.skipped, 1);
  assert.equal(await BookingSlot.countDocuments({ guide: w.users.g1._id }), 2);
});

test("who may create slots: guides only for themselves; coordinators only within their section and guides", async () => {
  const asOther = await g1.post("/bookings/slots", manual({ date: futureDate(5), guide: String(w.users.g2._id) }));
  assert.equal(asOther.status, 201);
  assert.equal(String((await BookingSlot.findOne({ date: futureDate(5) })).guide), String(w.users.g1._id), "guide field ignored for guides");
  assert.equal((await coordA.post("/bookings/slots", manual({ date: futureDate(6), guide: String(w.users.g2._id), section: String(w.B._id) }))).status, 403, "other section");
  assert.equal((await coordB.post("/bookings/slots", manual({ date: futureDate(6), guide: String(w.users.g2._id), section: String(w.B._id) }))).status, 403, "guide 2 has no teams in section B");
  assert.equal((await coordA.post("/bookings/slots", manual({ date: futureDate(6), guide: String(w.users.g2._id), section: String(w.A._id) }))).status, 201);
  assert.equal((await hod.post("/bookings/slots", manual({ date: futureDate(7), guide: String(w.users.g2._id) }))).status, 201);
  assert.equal((await s1.post("/bookings/slots", manual())).status, 403);
  // the guide never sees other guides' calendars or administrative controls
  const seen = (await g1.get("/bookings/slots")).body.slots;
  assert.ok(seen.every((s) => s.guide.id === String(w.users.g1._id)));
  assert.equal((await g1.patch("/bookings/policy", { enabled: false })).status, 403);
});

test("student request → guide approval; one approved slot per team per review; others cannot see who booked", async () => {
  const slot = await BookingSlot.findOne({ guide: w.users.g1._id, date: futureDate(3), startMin: 600 });
  const wrongGuide = await (await w.api(w.users.st[2])).post("/bookings/requests", { slotId: String(slot._id) });
  assert.equal(wrongGuide.status, 403, "student of guide 2 cannot take guide 1's slot");
  const req = await s1.post("/bookings/requests", { slotId: String(slot._id) });
  assert.equal(req.status, 201);
  assert.equal(req.body.request.status, "pending");
  assert.equal((await BookingSlot.findById(slot._id)).status, "pending");
  // same team, same review, another slot -> refused
  const other = await BookingSlot.findOne({ guide: w.users.g1._id, date: futureDate(3), startMin: 630 });
  assert.equal((await s1.post("/bookings/requests", { slotId: String(other._id) })).status, 409);

  assert.equal((await g2.post(`/bookings/requests/${req.body.request.id}/approve`)).status, 404, "not their team");
  assert.equal((await s1.post(`/bookings/requests/${req.body.request.id}/approve`)).status, 403);
  const ok = await g1.post(`/bookings/requests/${req.body.request.id}/approve`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.request.status, "approved");
  assert.equal((await BookingSlot.findById(slot._id)).status, "booked");
  const view = await (await w.api(w.users.st[4])).get("/bookings/slots");
  const seenSlot = view.body.slots.find((s) => s.id === String(slot._id));
  assert.equal(seenSlot.status, "booked");
  assert.equal(seenSlot.bookedTeam, null, "other teams cannot see who booked");
  assert.equal((await g1.post(`/bookings/requests/${req.body.request.id}/approve`)).status, 409, "cannot approve twice");
});

test("CONCURRENCY: simultaneous requests for one slot book exactly one team", async () => {
  const extra = [];
  for (let i = 0; i < 6; i++) {
    const u = await User.create({ name: `Extra ${i}`, email: `extra${i}@t.edu`, role: "student", rollNumber: `X${i}`, section: w.A._id });
    const t = await Team.create({ teamId: `X-T${i}`, section: w.A._id, guide: w.users.g1._id, leader: u._id });
    await User.updateOne({ _id: u._id }, { $set: { team: t._id } });
    extra.push(await w.api(u));
  }
  await reconcileCounters(); // the extra students/teams above were inserted directly, bypassing the seat/workload counters
  await g1.post("/bookings/slots", manual({ date: futureDate(8), start: "09:00", end: "09:30" }));
  const slot = await BookingSlot.findOne({ date: futureDate(8) });
  const results = await Promise.all(extra.map((c) => c.post("/bookings/requests", { slotId: String(slot._id) })));
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [201, 409, 409, 409, 409, 409]);
  assert.equal(await BookingRequest.countDocuments({ slot: slot._id, active: true }), 1);
  assert.equal((await BookingSlot.findById(slot._id)).status, "pending");
});

test("CONCURRENCY: one team cannot hold two slots for the same review via parallel requests; double approval is safe", async () => {
  await g1.post("/bookings/slots", { ...range({ dateFrom: futureDate(9), dateTo: futureDate(9), windows: [{ start: "09:00", end: "10:30" }] }) });
  const slots = await BookingSlot.find({ date: futureDate(9) });
  assert.equal(slots.length, 3);
  const team = await w.api(w.users.st[5]); // B-T01, guide 1
  const rs = await Promise.all(slots.map((s) => team.post("/bookings/requests", { slotId: String(s._id) })));
  assert.equal(rs.filter((r) => r.status === 201).length, 1);
  assert.equal(await BookingRequest.countDocuments({ team: w.teams.tB1._id, reviewKey: "review-2", active: true }), 1);
  assert.equal(await BookingSlot.countDocuments({ date: futureDate(9), status: "available" }), 2, "losing slots were released");
  const win = rs.find((r) => r.status === 201);
  const approvals = await Promise.all([g1.post(`/bookings/requests/${win.body.request.id}/approve`), g1.post(`/bookings/requests/${win.body.request.id}/approve`)]);
  assert.deepEqual(approvals.map((a) => a.status).sort(), [200, 409]);
});

test("rejection and cancellation release the slot, and the team may ask again", async () => {
  // review-3 session so this test is independent of other tests' review-2 bookings
  await g1.post("/bookings/slots", manual({ reviewKey: "review-3", date: futureDate(10), start: "09:00", end: "09:30" }));
  const slot = await BookingSlot.findOne({ date: futureDate(10), reviewKey: "review-3" });
  const c = await w.api(await User.findOne({ email: "extra0@t.edu" }));
  const r = await c.post("/bookings/requests", { slotId: String(slot._id) });
  assert.equal(r.status, 201);
  assert.equal((await g1.post(`/bookings/requests/${r.body.request.id}/reject`, {})).status, 400, "reason required");
  assert.equal((await g1.post(`/bookings/requests/${r.body.request.id}/reject`, { reason: "Guide unavailable" })).status, 200);
  assert.equal((await BookingSlot.findById(slot._id)).status, "available");
  const again = await c.post("/bookings/requests", { slotId: String(slot._id) });
  assert.equal(again.status, 201, "team can ask again after a rejection");
  assert.equal((await c.post(`/bookings/requests/${again.body.request.id}/cancel`)).status, 200);
  assert.equal((await BookingSlot.findById(slot._id)).status, "available");
  assert.equal((await BookingRequest.find({ slot: slot._id })).length, 2, "both attempts remain in history");
});

test("coordinator/HOD override is auditable (actor, reason, before/after) and bounded to scope", async () => {
  const approved = await BookingRequest.findOne({ team: w.teams.tA1._id, status: "approved" });
  const target = await BookingSlot.findOne({ guide: w.users.g1._id, date: futureDate(5) });
  assert.equal((await g1.post(`/bookings/requests/${approved._id}/override`, { action: "cancel", reason: "nope nope" })).status, 403, "guides use ordinary approval");
  assert.equal((await coordB.post(`/bookings/requests/${approved._id}/override`, { action: "cancel", reason: "other section" })).status, 404);
  assert.equal((await coordA.post(`/bookings/requests/${approved._id}/override`, { action: "reassign", slotId: String(target._id) })).status, 400, "reason is mandatory");
  const moved = await coordA.post(`/bookings/requests/${approved._id}/override`, { action: "reassign", slotId: String(target._id), reason: "Guide clash on original day" });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.request.overridden, true);
  assert.equal(moved.body.request.status, "approved");
  assert.equal((await BookingSlot.findById(target._id)).status, "booked");
  const log = await AuditLog.findOne({ action: "OVERRIDE", entity: "BookingRequest" }).lean();
  assert.equal(log.actorRole, "coordinator");
  assert.equal(log.reason, "Guide clash on original day");
  assert.notEqual(log.before.slot, log.after.slot);
  assert.ok(log.createdAt);
  const freed = await BookingSlot.findOne({ guide: w.users.g1._id, date: futureDate(3), startMin: 600 });
  assert.equal(freed.status, "available", "old slot released");
  // override approval of a pending request
  const hodCancel = await hod.post(`/bookings/requests/${approved._id}/override`, { action: "cancel", reason: "Review postponed" });
  assert.equal(hodCancel.status, 200);
  assert.equal(hodCancel.body.request.status, "cancelled");
  assert.ok(hodCancel.body.request.history.some((h) => h.action === "override-cancel" && h.reason === "Review postponed"));
});

test("booking is independent: disabling it blocks requests only; progress, feedback and reports keep working; history stays", async () => {
  const before = await BookingRequest.countDocuments();
  assert.equal((await coordA.patch("/bookings/policy", { section: String(w.B._id), enabled: false })).status, 403, "not their section");
  assert.equal((await coordA.patch("/bookings/policy", { enabled: false })).status, 403, "college policy is HOD only");
  assert.equal((await coordA.patch("/bookings/policy", { section: String(w.A._id), enabled: false })).status, 200);
  const sa = await w.api(w.users.st[0]);
  const free = await BookingSlot.findOne({ guide: w.users.g1._id, status: "available", date: futureDate(3) });
  const blocked = await sa.post("/bookings/requests", { slotId: String(free._id) });
  assert.equal(blocked.status, 403);
  assert.match(blocked.body.error, /disabled/);
  assert.equal((await sa.post("/teams/A-T01/reviews/review-1/submissions", { projectTitle: "Still works", problemStatement: "p", objectives: "o", requirementsStatus: "completed" })).status, 201);
  assert.equal((await g1.post("/bookings/slots", manual({ section: String(w.A._id), date: futureDate(11) }))).status, 403, "no new slots while disabled for the section");
  // other section unaffected
  assert.equal((await (await w.api(w.users.st[5])).get("/bookings/policy")).body.policy.enabled, true);
  // HOD disables college-wide; coordinator cannot re-enable
  assert.equal((await hod.patch("/bookings/policy", { enabled: false })).status, 200);
  assert.equal((await coordB.patch("/bookings/policy", { section: String(w.B._id), enabled: true })).status, 409);
  assert.equal(await BookingRequest.countDocuments(), before, "nothing deleted");
  assert.equal((await sa.get("/bookings/requests")).status, 200, "history still readable");
  assert.ok(await AuditLog.findOne({ entity: "BookingPolicy", action: "DISABLE" }));
  await hod.patch("/bookings/policy", { enabled: true });
});

test("request cut-off policy and leader-only policy are enforced", async () => {
  await coordB.patch("/bookings/policy", { section: String(w.B._id), requestBy: "leader" });
  const s6 = await w.api(w.users.st[5]);
  const slot = await BookingSlot.findOne({ guide: w.users.g1._id, status: "available", date: futureDate(9) });
  assert.equal((await s6.post("/bookings/requests", { slotId: String(slot._id) })).status, 403, "member, not leader");
  await hod.patch("/bookings/policy", { cutoffHoursBeforeSlot: 24 * 30 });
  assert.equal((await s2.post("/bookings/requests", { slotId: String(slot._id) })).status, 409);
  assert.equal((await coordA.patch("/bookings/policy", { section: String(w.A._id), cutoffHoursBeforeSlot: 1 })).status, 400, "a section cannot be looser than the college policy");
  await hod.patch("/bookings/policy", { cutoffHoursBeforeSlot: 0 });
});

test("database invariants hold after this suite's concurrent operations", async () => {
  const { checkConsistency } = await import("../src/shared/consistency.js");
  const bad = (await checkConsistency()).filter((f) => f.level === "violation");
  assert.deepEqual(bad, [], JSON.stringify(bad));
});
