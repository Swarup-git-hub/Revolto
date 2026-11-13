import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { buildWorld, startApp } from "./helpers.js";
import AuditLog from "../src/models/AuditLog.js";
import { reconcileCounters } from "../src/shared/counters.js";
import Notification from "../src/models/Notification.js";
import Team from "../src/models/Team.js";
import User from "../src/models/User.js";

let app, w, hod, g1, g2, coordA, n = 0;
before(async () => {
  app = await startApp("leader");
  w = await buildWorld(app.url);
  [hod, g1, g2, coordA] = await Promise.all([w.users.hod, w.users.g1, w.users.g2, w.users.coordA].map((u) => w.api(u)));
  await hod.patch("/settings", { guide: { maxTeams: 50 } }); // this suite creates many teams for one guide
});
after(() => app.stop());

/** Creates a team of `size` fresh students via the API; the first member is the leader. */
async function makeTeam(size) {
  const students = [];
  for (let i = 0; i < size; i++) { n++; students.push(await User.create({ name: `Mem ${n}`, email: `mem${n}@t.edu`, role: "student", rollNumber: `M${n}`, section: w.A._id })); }
  await reconcileCounters(); // students above were inserted directly
  const r = await hod.post("/teams", { section: String(w.A._id), guide: String(w.users.g1._id), memberIds: students.map((s) => String(s._id)), leader: String(students[0]._id) });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const team = await Team.findOne({ teamId: r.body.team.teamId });
  return { team, students };
}
const del = (c, team, student, replacement) => c.delete(`/teams/${team._id}/members/${student._id}${replacement ? `?replacementLeaderId=${replacement._id}` : ""}`);
const state = async (team) => { const t = await Team.findById(team._id).lean(); return { leader: t.leader && String(t.leader), members: (await User.find({ team: team._id }, "_id").lean()).map((u) => String(u._id)).sort() }; };

test("removing a NON-leader needs no replacement and keeps the leader", async () => {
  const { team, students } = await makeTeam(3);
  const r = await del(g1, team, students[2]);
  assert.equal(r.status, 200);
  const s = await state(team);
  assert.equal(s.leader, String(students[0]._id));
  assert.deepEqual(s.members, [String(students[0]._id), String(students[1]._id)].sort());
  assert.equal((await User.findById(students[2]._id)).team, null);
  // a stray replacement parameter on a non-leader removal is harmless
  const r2 = await del(g1, team, students[1], students[0]);
  assert.equal(r2.status, 200);
  assert.equal((await state(team)).leader, String(students[0]._id));
});

test("removing the leader WITHOUT a replacement is refused and nothing changes", async () => {
  const { team, students } = await makeTeam(3);
  const before = await state(team);
  const r = await del(g1, team, students[0]);
  assert.equal(r.status, 400);
  assert.match(r.body.error, /new team leader/i);
  assert.ok(r.body.details.replacementLeaderId);
  assert.deepEqual(await state(team), before, "team untouched");
  assert.ok(!(await AuditLog.findOne({ entityName: team.teamId, entity: "Team", action: "UPDATE" })), "no audit entry for a refused change");
});

test("valid replacement: leader switches first, member removed, team never leaderless, audited and notified", async () => {
  const { team, students } = await makeTeam(3);
  const r = await del(g1, team, students[0], students[1]);
  assert.equal(r.status, 200);
  const s = await state(team);
  assert.equal(s.leader, String(students[1]._id), "replacement is the leader");
  assert.ok(!s.members.includes(String(students[0]._id)));
  assert.equal(r.body.team.leader.id, String(students[1]._id));
  assert.equal(r.body.team.members.filter((m) => m.isLeader).length, 1);

  const log = await AuditLog.findOne({ entity: "Team", entityName: team.teamId, reason: /replacement leader/ }).lean();
  assert.ok(log, "audit record exists");
  assert.equal(log.actorRole, "guide");
  assert.equal(log.before.leader, students[0].rollNumber);
  assert.equal(log.after.leader, students[1].rollNumber);
  assert.equal(log.after.removedMember, students[0].rollNumber);

  const types = async (u) => (await Notification.find({ recipient: u._id }).lean()).map((x) => x.type);
  assert.ok((await types(students[0])).includes("team_member_removed"), "removed member told");
  assert.ok((await types(students[1])).includes("team_leader_changed"), "new leader told");
  assert.ok((await types(students[2])).includes("team_leader_changed"), "remaining members told");
});

test("invalid replacement leaders are refused (other team, same person, archived, non-member, malformed) with no change", async () => {
  const { team, students } = await makeTeam(3);
  const outsider = w.users.st[2]; // member of A-T02
  const archived = students[2];
  await User.updateOne({ _id: archived._id }, { $set: { isActive: false } });
  const before = await state(team);
  for (const [label, replacement] of [["other team", outsider], ["the leader themself", students[0]], ["archived member", archived], ["unknown id", { _id: "000000000000000000000001" }]]) {
    const r = await del(g1, team, students[0], replacement);
    assert.equal(r.status, 400, label);
    assert.deepEqual(await state(team), before, `${label}: unchanged`);
  }
  assert.equal((await g1.delete(`/teams/${team._id}/members/${students[0]._id}?replacementLeaderId=not-an-id`)).status, 400);
  assert.deepEqual(await state(team), before);
  await User.updateOne({ _id: archived._id }, { $set: { isActive: true } });
});

test("the only member (who is the leader) cannot be removed; guidance is given", async () => {
  const { team, students } = await makeTeam(1);
  const r = await del(g1, team, students[0]);
  assert.equal(r.status, 409);
  assert.match(r.body.error, /only member/);
  assert.equal((await state(team)).leader, String(students[0]._id));
  assert.equal((await del(g1, team, students[0], students[0])).status, 400);
});

test("existing removal permissions are unchanged (assigned guide, coordinator, HOD yes; other guide, other section, student, anonymous no)", async () => {
  const { team, students } = await makeTeam(4);
  assert.equal((await del(g2, team, students[3])).status, 404, "unassigned guide");
  assert.equal((await del(await w.api(w.users.coordB), team, students[3])).status, 404, "coordinator of another section");
  assert.equal((await del(await w.api(students[1]), team, students[3])).status, 403, "student");
  assert.equal((await del(w.anon, team, students[3])).status, 401);
  assert.equal((await del(coordA, team, students[3])).status, 200, "coordinator of the section");
  assert.equal((await del(hod, team, students[2], students[1])).status, 200, "HOD (leader is students[0]; students[2] is not leader)");
  const r = await del(hod, team, students[0], students[1]);
  assert.equal(r.status, 200, "HOD may replace the leader");
  assert.equal((await state(team)).leader, String(students[1]._id));
});

test("CONCURRENCY: two simultaneous leader removals never leave the team leaderless or with a non-member leader", async () => {
  const { team, students } = await makeTeam(4);
  const rs = await Promise.all([del(g1, team, students[0], students[1]), del(hod, team, students[0], students[2])]);
  assert.equal(rs.filter((r) => r.status === 200).length, 1, JSON.stringify(rs.map((r) => r.status)));
  const s = await state(team);
  assert.ok(s.leader, "has a leader");
  assert.ok(s.members.includes(s.leader), "the leader is a current member");
  assert.ok(!s.members.includes(String(students[0]._id)));
});

test("archiving a student who leads an active team is refused until another leader is appointed", async () => {
  const { team, students } = await makeTeam(2);
  const r = await hod.post(`/users/${students[0]._id}/archive`, {});
  assert.equal(r.status, 409);
  assert.match(r.body.error, /team leader/);
  assert.equal((await User.findById(students[0]._id)).isActive, true);
  assert.equal((await hod.patch(`/teams/${team._id}`, { leader: String(students[1]._id) })).status, 200);
  assert.equal((await hod.post(`/users/${students[0]._id}/archive`, {})).status, 200);
});

test("database invariants hold after this suite's concurrent operations", async () => {
  const { checkConsistency } = await import("../src/shared/consistency.js");
  const bad = (await checkConsistency()).filter((f) => f.level === "violation");
  assert.deepEqual(bad, [], JSON.stringify(bad));
});
