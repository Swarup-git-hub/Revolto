import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { buildWorld, startApp } from "./helpers.js";
import User from "../src/models/User.js";
import Team from "../src/models/Team.js";
import AuditLog from "../src/models/AuditLog.js";
import { reconcileCounters } from "../src/shared/counters.js";

let app, w;
before(async () => { app = await startApp("scope"); w = await buildWorld(app.url); });
after(() => app.stop());

const ids = (r) => r.body.teams.map((t) => t.teamId).sort();

test("team lists are scoped by role on the server", async () => {
  assert.deepEqual(ids(await (await w.api(w.users.hod)).get("/teams")), ["A-T01", "A-T02", "B-T01"]);
  assert.deepEqual(ids(await (await w.api(w.users.coordA)).get("/teams")), ["A-T01", "A-T02"]);
  assert.deepEqual(ids(await (await w.api(w.users.coordB)).get("/teams")), ["B-T01"]);
  assert.deepEqual(ids(await (await w.api(w.users.g1)).get("/teams")), ["A-T01", "B-T01"], "guides can be assigned across sections");
  assert.deepEqual(ids(await (await w.api(w.users.g2)).get("/teams")), ["A-T02"]);
  assert.deepEqual(ids(await (await w.api(w.users.st[0])).get("/teams")), ["A-T01"]);
});

test("direct access to a team outside scope looks like 'not found'", async () => {
  const g2 = await w.api(w.users.g2);
  assert.equal((await g2.get(`/teams/${w.teams.tA1._id}`)).status, 404);
  const coordB = await w.api(w.users.coordB);
  assert.equal((await coordB.get(`/teams/${w.teams.tA1._id}`)).status, 404);
  const s3 = await w.api(w.users.st[2]);
  assert.equal((await s3.get("/teams/A-T01")).status, 404);
  assert.equal((await (await w.api(w.users.st[0])).get("/teams/A-T01")).status, 200);
});

test("a student cannot write to another team's reviews or contributions", async () => {
  const s3 = await w.api(w.users.st[2]);
  assert.equal((await s3.post("/teams/A-T01/reviews/review-2/contributions", { summary: "x" })).status, 404);
  assert.equal((await s3.post("/teams/A-T01/reviews/review-1/submissions", {})).status, 404);
});

test("only the team leader can submit for the team; members cannot", async () => {
  const member = await w.api(w.users.st[1]);
  const r = await member.post("/teams/A-T01/reviews/review-1/submissions", { projectTitle: "T", problemStatement: "p", objectives: "o", requirementsStatus: "not_started" });
  assert.equal(r.status, 403);
});

test("mass assignment: role, section, team and ownership fields in bodies are ignored or refused", async () => {
  const coord = await w.api(w.users.coordA);
  const create = await coord.post("/users", { name: "New", email: "new@t.edu", role: "student", rollNumber: "RX1", section: String(w.A._id), team: String(w.teams.tA2._id), isActive: true, tokenVersion: 99, createdBy: String(w.users.hod._id) });
  assert.equal(create.status, 201);
  const fresh = await User.findOne({ email: "new@t.edu" }).lean();
  assert.equal(fresh.team, null, "team is never set via user creation");
  assert.equal(fresh.tokenVersion, 0);
  assert.equal(String(fresh.createdBy), String(w.users.coordA._id));
  // a coordinator cannot mint privileged roles or touch other sections
  assert.equal((await coord.post("/users", { name: "X", email: "x@t.edu", role: "hod" })).status, 403);
  assert.equal((await coord.post("/users", { name: "Y", email: "y@t.edu", role: "student", rollNumber: "RY", section: String(w.B._id) })).status, 403);
  // PATCH cannot escalate role for coordinators
  const patch = await coord.patch(`/users/${w.users.st[0]._id}`, { role: "hod", name: "Renamed" });
  assert.equal(patch.status, 200);
  assert.equal((await User.findById(w.users.st[0]._id).lean()).role, "student");
  // a student cannot set the title or restructure the team through the team endpoints
  const s = await w.api(w.users.st[0]);
  assert.equal((await s.patch("/teams/A-T01", { guide: String(w.users.g2._id) })).status, 403);
  assert.equal((await s.patch("/teams/A-T01/title", { projectTitle: "Hacked", reason: "because" })).status, 403);
});

test("guides manage only their own teams and cannot gain section-wide admin access", async () => {
  const g2 = await w.api(w.users.g2);
  assert.equal((await g2.post(`/teams/${w.teams.tA1._id}/members`, { studentId: String(w.users.st[3]._id) })).status, 404);
  assert.equal((await g2.get("/users")).status, 403);
  assert.equal((await g2.patch("/teams/A-T02", { guide: String(w.users.g1._id) })).status, 200, "route allowed but guide field is ignored for guides");
  assert.equal(String((await Team.findOne({ teamId: "A-T02" })).guide), String(w.users.g2._id));
});

test("team size, guide workload and section capacity limits come from settings", async () => {
  const hod = await w.api(w.users.hod);
  assert.equal((await hod.patch("/settings", { team: { maxSize: 2 } })).status, 200);
  const g1 = await w.api(w.users.g1);
  const extra = await User.create({ name: "Extra", email: "extra@t.edu", role: "student", rollNumber: "RE", section: w.A._id });
  await reconcileCounters(); // direct inserts bypass the seat counter; reconcile as an operator would
  const full = await g1.post(`/teams/${w.teams.tA1._id}/members`, { studentId: String(extra._id) });
  assert.equal(full.status, 409);
  assert.match(full.body.error, /at most 2/);
  await hod.patch("/settings", { team: { maxSize: 4 }, guide: { maxTeams: 1 } });
  const over = await hod.post("/teams", { section: String(w.A._id), guide: String(w.users.g1._id), memberIds: [String(extra._id)] });
  assert.equal(over.status, 409, "g1 already guides 2 teams");
  await hod.patch("/settings", { guide: { maxTeams: 4 } });
  await hod.patch(`/sections/${w.A._id}`, { capacity: 5 });
  const full2 = await (await w.api(w.users.coordA)).post("/users", { name: "Over", email: "over@t.edu", role: "student", rollNumber: "RO", section: String(w.A._id) });
  assert.equal(full2.status, 409);
  await hod.patch(`/sections/${w.A._id}`, { capacity: null });
});

test("title edits by the guide record old/new value, actor, time and reason, and require reconfirmation", async () => {
  await Team.updateOne({ _id: w.teams.tA1._id }, { $set: { projectTitle: "Old Title", titleStatus: "confirmed" } });
  const g1 = await w.api(w.users.g1);
  assert.equal((await g1.patch("/teams/A-T01/title", { projectTitle: "New Title" })).status, 400, "reason is mandatory");
  const r = await g1.patch("/teams/A-T01/title", { projectTitle: "New Title", reason: "Clarified scope with the team" });
  assert.equal(r.status, 200);
  assert.equal(r.body.team.projectTitle, "New Title");
  assert.equal(r.body.team.titleStatus, "submitted", "reconfirmation required after a confirmed title changes");
  const h = r.body.team.titleHistory.at(-1);
  assert.equal(h.oldTitle, "Old Title");
  assert.equal(h.newTitle, "New Title");
  assert.equal(h.actorName, "Guide One");
  assert.equal(h.reason, "Clarified scope with the team");
  assert.ok(h.at);
  assert.equal((await g1.post("/teams/A-T01/title/confirm")).body.team.titleStatus, "confirmed");
  assert.ok(await AuditLog.findOne({ entity: "Team", action: "UPDATE", reason: "Clarified scope with the team" }), "also written to the audit log");
});

test("accounts with history are archived, never hard-deleted", async () => {
  const hod = await w.api(w.users.hod);
  assert.equal((await hod.delete(`/users/${w.users.st[0]._id}`)).status, 404, "no delete route exists");
  assert.equal((await hod.post(`/users/${w.users.g1._id}/archive`, {})).status, 409, "guide with active teams must be reassigned first");
  const r = await hod.post(`/users/${w.users.st[3]._id}/archive`, { reason: "left" });
  assert.equal(r.status, 200);
  assert.equal((await User.findById(w.users.st[3]._id)).isActive, false);
  assert.ok(await User.findById(w.users.st[3]._id), "record is still there");
});
