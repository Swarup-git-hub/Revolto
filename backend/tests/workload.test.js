import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildWorld, startApp } from "./helpers.js";
import Team from "../src/models/Team.js";
import User from "../src/models/User.js";
import Settings from "../src/models/Settings.js";
import { reconcileCounters } from "../src/shared/counters.js";

let app, w, hod, g3;
before(async () => {
  app = await startApp("workload");
  w = await buildWorld(app.url);
  g3 = await User.create({ name: "Guide Three", email: "g3@t.edu", role: "guide" });
  hod = await w.api(w.users.hod);
});
after(() => app.stop());

const setMax = (n) => hod.patch("/settings", { guide: { maxTeams: n } });
const real = (g) => Team.countDocuments({ guide: g._id, status: "active" });
const counter = async (g) => (await User.findById(g._id).lean()).activeTeamCount;
const consistent = async (g) => assert.equal(await counter(g), await real(g), `counter == real active teams for ${g.name}`);
const mkTeam = (guide, section = w.A, extra = {}) => hod.post("/teams", { section: String(section._id), guide: String(guide._id), ...extra });
const freshStudent = (n, section = w.A) => User.create({ name: `Loose ${n}`, email: `loose${n}@t.edu`, role: "student", rollNumber: `LS${n}`, section: section._id });

beforeEach(async () => {
  // restore a known baseline: archive extra teams created by earlier tests, normal limit
  await Team.updateMany({ teamId: { $nin: ["A-T01", "A-T02", "B-T01"] } }, { $set: { status: "archived" } });
  await Team.updateMany({ teamId: "A-T02" }, { $set: { guide: w.users.g2._id, status: "active" } });
  await Team.updateMany({ teamId: { $in: ["A-T01", "B-T01"] } }, { $set: { guide: w.users.g1._id, status: "active" } });
  await setMax(4);
  await reconcileCounters();
});

test("guide already at the limit: new team refused, nothing created, nothing changed", async () => {
  await setMax(2); // g1 already has 2
  const before = await Team.countDocuments();
  const r = await mkTeam(w.users.g1);
  assert.equal(r.status, 409);
  assert.match(r.body.error, /maximum of 2 teams/);
  assert.equal(await Team.countDocuments(), before);
  assert.equal(await counter(w.users.g1), 2);
  assert.equal((await Settings.findOne().lean()).guide.maxTeams, 2, "configured maximum is untouched");
});

test("CONCURRENCY: 8 parallel team creations competing for the last place → exactly one wins", async () => {
  await setMax(2);
  assert.equal((await mkTeam(g3)).status, 201);
  const rs = await Promise.all(Array.from({ length: 8 }, () => mkTeam(g3)));
  assert.equal(rs.filter((r) => r.status === 201).length, 1);
  assert.equal(rs.filter((r) => r.status === 409).length, 7);
  assert.equal(await real(g3), 2);
  assert.equal(await counter(g3), 2);
});

test("reassigning to a full guide is refused and the team keeps its guide", async () => {
  await setMax(2);
  const r = await hod.patch(`/teams/${w.teams.tA2._id}`, { guide: String(w.users.g1._id) });
  assert.equal(r.status, 409);
  assert.equal(String((await Team.findById(w.teams.tA2._id)).guide), String(w.users.g2._id), "no silent change");
  assert.deepEqual([await counter(w.users.g1), await counter(w.users.g2)], [2, 1]);
});

test("reassignment moves the workload: new guide +1, old guide −1", async () => {
  const r = await hod.patch(`/teams/${w.teams.tA2._id}`, { guide: String(g3._id) });
  assert.equal(r.status, 200);
  assert.deepEqual([await counter(w.users.g2), await counter(g3)], [0, 1]);
  await consistent(w.users.g2); await consistent(g3);
});

test("CONCURRENCY: two teams reassigned to a guide with one free place → exactly one moves", async () => {
  await setMax(1);
  // g3 has 0 teams, g1 has 2, g2 has 1 (all above/at limit 1 is fine for existing data)
  const rs = await Promise.all([hod.patch(`/teams/${w.teams.tA2._id}`, { guide: String(g3._id) }), hod.patch(`/teams/${w.teams.tB1._id}`, { guide: String(g3._id) })]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
  assert.equal(await counter(g3), 1);
  await consistent(g3); await consistent(w.users.g1); await consistent(w.users.g2);
});

test("archive releases the place (exactly once); restore reserves it and is refused when the guide is full", async () => {
  assert.equal((await hod.post(`/teams/${w.teams.tA2._id}/archive`, {})).status, 200);
  assert.equal(await counter(w.users.g2), 0);
  assert.equal((await hod.post(`/teams/${w.teams.tA2._id}/archive`, {})).status, 409);
  assert.equal(await counter(w.users.g2), 0, "second archive must not release again");
  await setMax(1);
  assert.equal((await mkTeam(w.users.g2, w.A)).status, 201, "g2's freed place is usable");
  const refused = await hod.post(`/teams/${w.teams.tA2._id}/restore`, {});
  assert.equal(refused.status, 409);
  assert.equal((await Team.findById(w.teams.tA2._id)).status, "archived", "still archived");
  await consistent(w.users.g2);
  await setMax(4);
  assert.equal((await hod.post(`/teams/${w.teams.tA2._id}/restore`, {})).status, 200);
  assert.equal(await counter(w.users.g2), 2);
  await consistent(w.users.g2);
});

test("CONCURRENCY: restoring an archived team and creating a new one race for the last place → exactly one", async () => {
  await hod.post(`/teams/${w.teams.tA2._id}/archive`, {});
  await setMax(1);
  const rs = await Promise.all([hod.post(`/teams/${w.teams.tA2._id}/restore`, {}), mkTeam(w.users.g2, w.A)]);
  assert.ok(rs.every((r) => [200, 201, 409].includes(r.status)));
  assert.equal(rs.filter((r) => r.status === 409).length, 1);
  assert.equal(await counter(w.users.g2), 1);
  await consistent(w.users.g2);
});

test("bulk team import: workload re-checked at confirmation (a place was taken between preview and confirm)", async () => {
  await setMax(2);
  await Promise.all([freshStudent(1), freshStudent(2)]);
  await reconcileCounters(); // students were inserted directly
  const csv = ["teamId,section,guideEmail,projectTitle,leaderRoll,memberRolls", ",A,g3@t.edu,One,LS1,LS1", ",A,g3@t.edu,Two,LS2,LS2"].join("\n");
  const fd = new FormData(); fd.append("file", new Blob([csv]), "t.csv");
  const pj = await (await fetch(`${app.url}/imports/teams/preview`, { method: "POST", headers: { Authorization: `Bearer ${await w.tok(w.users.hod)}` }, body: fd })).json();
  assert.equal(pj.summary.valid, 2);
  assert.equal((await mkTeam(g3)).status, 201, "someone else takes a place after the preview");
  const c = await hod.post(`/imports/jobs/${pj.id}/confirm`, { confirm: true });
  assert.deepEqual([c.body.result.created, c.body.result.failed], [1, 1]);
  assert.match(c.body.result.failures[0], /maximum of 2 teams/);
  assert.equal(await real(g3), 2);
  await consistent(g3);
  assert.equal(await User.countDocuments({ rollNumber: { $in: ["LS1", "LS2"] }, team: { $ne: null } }), 1, "the refused row's student was not left half-assigned");
});

test("failed team creation releases its reservation (member already in another team; wrong-section member)", async () => {
  const before = await counter(g3);
  const taken = await mkTeam(g3, w.A, { memberIds: [String(w.users.st[0]._id)] }); // already in A-T01
  assert.equal(taken.status, 409);
  assert.equal(await counter(g3), before);
  const wrongSection = await mkTeam(g3, w.A, { memberIds: [String(w.users.st[4]._id)] }); // section B student
  assert.equal(wrongSection.status, 409);
  assert.equal(await counter(g3), before);
  assert.equal(await Team.countDocuments({ guide: g3._id, status: "active" }), await counter(g3));
  assert.equal((await User.findById(w.users.st[4]._id)).team.toString(), String(w.teams.tB1._id), "existing memberships untouched");
});

test("reconciliation repairs wrong/missing guide counters; legacy guides initialise from real data; saves never write a bogus counter", async () => {
  await User.updateOne({ _id: w.users.g1._id }, { $set: { activeTeamCount: 9 } });
  await User.updateOne({ _id: w.users.g2._id }, { $unset: { activeTeamCount: 1 } });
  const r = await hod.post("/sections/reconcile", {});
  assert.deepEqual(r.body.guides.map((x) => x.guide).sort(), ["Guide One", "Guide Two"]);
  await consistent(w.users.g1); await consistent(w.users.g2);
  // legacy guide (no counter) is renamed through the API: save() must not invent a counter value
  await User.updateOne({ _id: g3._id }, { $unset: { activeTeamCount: 1 } });
  assert.equal((await hod.patch(`/users/${g3._id}`, { name: "Guide Three (renamed)" })).status, 200);
  assert.equal((await User.findById(g3._id).lean()).activeTeamCount, undefined);
  await setMax(2);
  assert.equal((await mkTeam(g3)).status, 201);
  assert.equal((await mkTeam(g3)).status, 201);
  assert.equal((await mkTeam(g3)).status, 409, "baseline came from real data (0) so the limit of 2 holds");
  await consistent(g3);
});

test("database invariants hold after this suite's concurrent operations", async () => {
  const { checkConsistency } = await import("../src/shared/consistency.js");
  const bad = (await checkConsistency()).filter((f) => f.level === "violation");
  assert.deepEqual(bad, [], JSON.stringify(bad));
});
