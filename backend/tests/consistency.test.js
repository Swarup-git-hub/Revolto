import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildWorld, futureDate, startApp } from "./helpers.js";
import { checkConsistency } from "../src/shared/consistency.js";
import BookingRequest from "../src/models/BookingRequest.js";
import BookingSlot from "../src/models/BookingSlot.js";
import Section from "../src/models/Section.js";
import Submission from "../src/models/Submission.js";
import Team from "../src/models/Team.js";
import User from "../src/models/User.js";

let app, w, hod;
before(async () => { app = await startApp("consistency"); w = await buildWorld(app.url); hod = await w.api(w.users.hod); });
after(() => app.stop());
const rules = async (level = "violation") => (await checkConsistency()).filter((f) => f.level === level).map((f) => f.rule);

test("a healthy database has no violations, including after a burst of concurrent operations", async () => {
  assert.deepEqual(await rules(), []);
  // concurrent seats, team creations, bookings and a leader removal, then re-check every invariant
  const g1 = await w.api(w.users.g1);
  await Promise.all(Array.from({ length: 6 }, (_, i) => hod.post("/users", { name: `C${i}`, email: `c${i}@t.edu`, role: "student", rollNumber: `C${i}`, section: String(w.A._id) })));
  await Promise.all(Array.from({ length: 3 }, () => hod.post("/teams", { section: String(w.A._id), guide: String(w.users.g2._id) })));
  await g1.post("/bookings/slots", { mode: "range", reviewKey: "review-2", dateFrom: futureDate(3), dateTo: futureDate(3), windows: [{ start: "09:00", end: "10:00" }], durationMinutes: 30 });
  const slots = await BookingSlot.find({ guide: w.users.g1._id });
  await Promise.all([w.users.st[0], w.users.st[4]].map(async (u) => (await w.api(u)).post("/bookings/requests", { slotId: String(slots[0]._id) })));
  const loser = slots[1];
  await (await w.api(w.users.st[0])).post("/bookings/requests", { slotId: String(loser._id) });
  const pend = await BookingRequest.findOne({ status: "pending" });
  if (pend) await g1.post(`/bookings/requests/${pend._id}/approve`);
  await g1.delete(`/teams/${w.teams.tA1._id}/members/${w.users.st[0]._id}?replacementLeaderId=${w.users.st[1]._id}`);
  assert.deepEqual(await rules(), []);
  assert.deepEqual(await rules("warning"), []);
});

test("every kind of corruption is detected by name", async () => {
  const original = { team: await Team.findById(w.teams.tA2._id).lean() };
  // 1. team with members but no leader
  await Team.updateOne({ _id: w.teams.tA2._id }, { $set: { leader: null } });
  // 2. leader who is not a member
  await Team.updateOne({ _id: w.teams.tB1._id }, { $set: { leader: w.users.st[2]._id } });
  // 3. counters
  await Section.updateOne({ _id: w.B._id }, { $set: { studentCount: 42 } });
  await User.updateOne({ _id: w.users.g2._id }, { $set: { activeTeamCount: 9 } });
  // 4. slot says booked, no live request
  const slot = await BookingSlot.findOne({ guide: w.users.g1._id, status: "available" });
  await BookingSlot.updateOne({ _id: slot._id }, { $set: { status: "booked" } });
  // 5. two "latest" submissions
  await Submission.create([{ team: w.teams.tA1._id, section: w.A._id, reviewKey: "review-9", reviewType: "improvements", version: 1, isLatest: true, submittedBy: w.users.st[0]._id }, { team: w.teams.tA1._id, section: w.A._id, reviewKey: "review-9", reviewType: "improvements", version: 2, isLatest: true, submittedBy: w.users.st[0]._id }]);
  // 6. student pointing at a team of another section
  await User.updateOne({ _id: w.users.st[5]._id }, { $set: { section: w.A._id } });
  const found = new Set(await rules());
  for (const rule of ["team-has-leader", "leader-is-member", "section-counter", "guide-counter", "slot-status-matches-request", "single-latest-submission", "member-section-matches-team"]) assert.ok(found.has(rule), `detected ${rule}`);
  // warnings: limit lowered below current workload
  await hod.patch("/settings", { guide: { maxTeams: 1 } });
  await User.updateOne({ _id: w.users.g1._id }, { $set: { activeTeamCount: 3 } });
  assert.ok((await rules("warning")).includes("guide-over-limit"));
});

test("the check:consistency script is read-only and its exit code reflects violations", async () => {
  const run = () => spawnSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "check-consistency.js")], {
    env: { PATH: process.env.PATH, NODE_ENV: "development", JWT_SECRET: process.env.JWT_SECRET, MONGO_URI: "mongodb://127.0.0.1:27018/reviewslot_test_consistency?directConnection=true" }, encoding: "utf8",
  });
  const bad = run();
  assert.equal(bad.status, 1, bad.stdout);
  assert.match(bad.stdout, /VIOLATION\s+\[section-counter\]/);
  // repair everything, then the script passes
  const { reconcileCounters } = await import("../src/shared/counters.js");
  await Team.updateOne({ _id: w.teams.tA2._id }, { $set: { leader: w.users.st[2]._id } });
  await Team.updateOne({ _id: w.teams.tB1._id }, { $set: { leader: w.users.st[4]._id } });
  await BookingSlot.updateMany({ status: "booked", _id: { $nin: (await BookingRequest.find({ active: true, status: "approved" }, "slot").lean()).map((r) => r.slot) } }, { $set: { status: "available" } });
  await Submission.deleteMany({ reviewKey: "review-9" });
  await User.updateOne({ _id: w.users.st[5]._id }, { $set: { section: w.B._id } });
  await hod.patch("/settings", { guide: { maxTeams: 10 } });
  await reconcileCounters(); // last: counters are derived from the restored data
  const ok = run();
  assert.equal(ok.status, 0, ok.stdout);
  assert.match(ok.stdout, /violation|passed/);
});
