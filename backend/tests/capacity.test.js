import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildWorld, startApp } from "./helpers.js";
import Section from "../src/models/Section.js";
import User from "../src/models/User.js";
import { createStudentWithSeat } from "../src/modules/sections/capacity.js";
import { reconcileCounters } from "../src/shared/counters.js";

let app, w, hod;
before(async () => { app = await startApp("capacity"); w = await buildWorld(app.url); hod = await w.api(w.users.hod); });
after(() => app.stop());
beforeEach(async () => {
  await Section.updateMany({}, { $set: { capacity: null } });
  await reconcileCounters();
});

let n = 0;
const body = (section, over = {}) => { n++; return { name: `New ${n}`, email: `new${n}@t.edu`, role: "student", rollNumber: `NN${n}`, section: String(section._id), ...over }; };
const real = (s) => User.countDocuments({ role: "student", section: s._id, isActive: true });
const counter = async (s) => (await Section.findById(s._id).lean()).studentCount;
const setCap = (s, capacity) => hod.patch(`/sections/${s._id}`, { capacity });
/** Fills the section so that exactly `free` seats remain, returning the capacity used. */
async function fillTo(s, free) {
  const cap = (await real(s)) + free;
  assert.equal((await setCap(s, cap)).status, 200);
  return cap;
}
const consistent = async (s) => assert.equal(await counter(s), await real(s), "counter equals real active students");

test("normal enforcement: students beyond capacity are refused with a clear message; counter stays exact", async () => {
  const cap = await fillTo(w.A, 1);
  assert.equal((await hod.post("/users", body(w.A))).status, 201);
  const full = await hod.post("/users", body(w.A));
  assert.equal(full.status, 409);
  assert.match(full.body.error, new RegExp(`at capacity \\(${cap}/${cap}`));
  assert.equal(await real(w.A), cap);
  await consistent(w.A);
});

test("CONCURRENCY: 8 parallel creations competing for the last seat → exactly one wins", async () => {
  const cap = await fillTo(w.A, 1);
  const results = await Promise.all(Array.from({ length: 8 }, () => hod.post("/users", body(w.A))));
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409, 409, 409, 409, 409, 409]);
  assert.equal(await real(w.A), cap);
  assert.equal(await counter(w.A), cap);
});

test("CONCURRENCY with several seats: never more students than capacity", async () => {
  const cap = await fillTo(w.B, 3);
  const results = await Promise.all(Array.from({ length: 10 }, () => hod.post("/users", body(w.B))));
  assert.equal(results.filter((r) => r.status === 201).length, 3);
  assert.equal(await real(w.B), cap);
  await consistent(w.B);
});

test("failed creation releases its reservation (duplicate email raced in parallel; direct helper failure)", async () => {
  await setCap(w.A, 50);
  const before = await counter(w.A);
  const same = body(w.A);
  const results = await Promise.all([hod.post("/users", same), hod.post("/users", same)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal(await counter(w.A), before + 1, "the loser gave its seat back");
  await consistent(w.A);
  // direct: the unique index rejects the insert AFTER the seat was reserved
  const dup = body(w.A, { email: same.email });
  await assert.rejects(createStudentWithSeat({ name: dup.name, email: dup.email, role: "student", rollNumber: dup.rollNumber, section: w.A._id }));
  assert.equal(await counter(w.A), before + 1, "reservation released after the failed insert");
  await consistent(w.A);
});

test("section transfer: refused into a full section (nothing changes), succeeds once there is room, seats move", async () => {
  const loose = (await hod.post("/users", body(w.A))).body.user;
  await fillTo(w.B, 0);
  const aBefore = await counter(w.A), bBefore = await counter(w.B);
  const refused = await hod.patch(`/users/${loose.id}`, { section: String(w.B._id) });
  assert.equal(refused.status, 409);
  assert.equal((await User.findById(loose.id)).section.toString(), String(w.A._id), "student stayed put");
  assert.deepEqual([await counter(w.A), await counter(w.B)], [aBefore, bBefore]);
  await setCap(w.B, bBefore + 1);
  assert.equal((await hod.patch(`/users/${loose.id}`, { section: String(w.B._id) })).status, 200);
  assert.deepEqual([await counter(w.A), await counter(w.B)], [aBefore - 1, bBefore + 1]);
  await consistent(w.A); await consistent(w.B);
});

test("CONCURRENCY: two students transferring into the last seat of a section → exactly one moves", async () => {
  const [a, b] = [(await hod.post("/users", body(w.A))).body.user, (await hod.post("/users", body(w.A))).body.user];
  await fillTo(w.B, 1);
  const rs = await Promise.all([a, b].map((u) => hod.patch(`/users/${u.id}`, { section: String(w.B._id) })));
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
  await consistent(w.A); await consistent(w.B);
});

test("archive frees the seat; restore into a full section is refused; restore succeeds when there is room; restoring an active user changes nothing", async () => {
  const stu = (await hod.post("/users", body(w.A))).body.user;
  assert.equal((await hod.post(`/users/${stu.id}/archive`, {})).status, 200);
  await consistent(w.A);
  const cap = await fillTo(w.A, 0); // filled by the remaining active students
  const full = await hod.post(`/users/${stu.id}/restore`, {});
  assert.equal(full.status, 409);
  assert.equal((await User.findById(stu.id)).isActive, false, "still archived");
  await consistent(w.A);
  await setCap(w.A, cap + 1);
  assert.equal((await hod.post(`/users/${stu.id}/restore`, {})).status, 200);
  assert.equal(await counter(w.A), cap + 1);
  assert.equal((await hod.post(`/users/${stu.id}/restore`, {})).status, 200, "idempotent");
  assert.equal(await counter(w.A), cap + 1, "no double counting");
  // archiving twice must not release twice
  await hod.post(`/users/${stu.id}/archive`, {});
  const afterOne = await counter(w.A);
  await hod.post(`/users/${stu.id}/archive`, {});
  assert.equal(await counter(w.A), afterOne);
  await consistent(w.A);
});

test("role change away from student releases the seat", async () => {
  const stu = (await hod.post("/users", body(w.A))).body.user;
  const before = await counter(w.A);
  assert.equal((await hod.patch(`/users/${stu.id}`, { role: "guide" })).status, 200);
  assert.equal(await counter(w.A), before - 1);
  await consistent(w.A);
});

test("bulk import: capacity is re-checked at confirmation, after it changed between preview and confirm", async () => {
  await setCap(w.A, 500);
  const csv = ["rollNumber,name,email,section,phone", "IMP1,Imp One,imp1@t.edu,A,", "IMP2,Imp Two,imp2@t.edu,A,"].join("\n");
  const fd = new FormData(); fd.append("file", new Blob([csv]), "s.csv");
  const preview = await fetch(`${app.url}/imports/students/preview`, { method: "POST", headers: { Authorization: `Bearer ${await w.tok(w.users.hod)}` }, body: fd });
  const pj = await preview.json();
  assert.equal(pj.summary.valid, 2, "both rows fit at preview time");
  // meanwhile someone else takes seats so only ONE remains
  await fillTo(w.A, 1);
  const c = await hod.post(`/imports/jobs/${pj.id}/confirm`, { confirm: true });
  assert.equal(c.status, 200);
  assert.deepEqual([c.body.result.created, c.body.result.failed], [1, 1]);
  assert.match(c.body.result.failures[0], /at capacity/);
  assert.equal(await User.countDocuments({ rollNumber: { $in: ["IMP1", "IMP2"] } }), 1);
  await consistent(w.A);
});

test("reconciliation: corrupted, missing and stale counters are repaired and reported; HOD only", async () => {
  await Section.updateOne({ _id: w.A._id }, { $set: { studentCount: 99 } });
  await Section.updateOne({ _id: w.B._id }, { $unset: { studentCount: 1 } });
  const coordinator = await w.api(w.users.coordA);
  assert.equal((await coordinator.post("/sections/reconcile", {})).status, 403);
  const r = await hod.post("/sections/reconcile", {});
  assert.equal(r.status, 200);
  const fixedNames = r.body.sections.map((x) => x.section).sort();
  assert.deepEqual(fixedNames, ["A", "B"]);
  assert.equal(r.body.sections.find((x) => x.section === "A").from, 99);
  assert.equal(r.body.sections.find((x) => x.section === "B").from, null);
  await consistent(w.A); await consistent(w.B);
  assert.deepEqual((await hod.post("/sections/reconcile", {})).body.sections, [], "second run finds nothing to fix");
});

test("sections created before counters existed (no field) initialise correctly on first use", async () => {
  await Section.updateOne({ _id: w.B._id }, { $unset: { studentCount: 1 } });
  const cap = (await real(w.B)) + 1;
  await setCap(w.B, cap);
  const results = await Promise.all([hod.post("/users", body(w.B)), hod.post("/users", body(w.B)), hod.post("/users", body(w.B))]);
  assert.equal(results.filter((r) => r.status === 201).length, 1, "baseline came from real data, so only one seat was free");
  assert.equal(await counter(w.B), cap);
});

test("archived or unknown sections never hand out seats", async () => {
  await hod.patch(`/sections/${w.B._id}`, { isActive: false });
  assert.equal((await hod.post("/users", body(w.B))).status, 404);
  await hod.patch(`/sections/${w.B._id}`, { isActive: true });
});

test("database invariants hold after this suite's concurrent operations", async () => {
  const { checkConsistency } = await import("../src/shared/consistency.js");
  const bad = (await checkConsistency()).filter((f) => f.level === "violation");
  assert.deepEqual(bad, [], JSON.stringify(bad));
});
