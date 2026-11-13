import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { buildWorld, futureDate, startApp } from "./helpers.js";
import Section from "../src/models/Section.js";
import Team from "../src/models/Team.js";
import User from "../src/models/User.js";
import { computeProgress } from "../src/modules/reviews/progress.service.js";

let app, w, hod, coordA, coordB, g1, g2, studentA, bigSlots = 650, bigTeams = 360, bigStudents = 260;
const oid = () => new mongoose.Types.ObjectId();
const now = new Date();
const col = (name) => mongoose.connection.db.collection(name);

before(async () => {
  app = await startApp("pagination");
  w = await buildWorld(app.url);
  [hod, coordA, coordB, g1, g2, studentA] = await Promise.all([w.users.hod, w.users.coordA, w.users.coordB, w.users.g1, w.users.g2, w.users.st[0]].map((u) => w.api(u)));
});
after(() => app.stop());

/** Walks every page of a list endpoint and returns all rows (asserting pages are consistent). */
async function walk(client, path, key, limit) {
  const sep = path.includes("?") ? "&" : "?";
  const first = await client.get(`${path}${sep}limit=${limit}&page=1`);
  assert.equal(first.status, 200, path);
  const pages = Math.max(1, Math.ceil(first.body.total / first.body.limit));
  const rows = [...first.body[key]];
  for (let p = 2; p <= pages; p++) rows.push(...(await client.get(`${path}${sep}limit=${limit}&page=${p}`)).body[key]);
  assert.equal(rows.length, first.body.total, `${path}: every record is reachable through the pages`);
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length, `${path}: pages do not overlap`);
  return { rows, total: first.body.total, limit: first.body.limit };
}

test("dashboard (aggregation) matches the per-team progress logic on a small mixed-state world", async () => {
  const leader = await w.api(w.users.st[0]), g = g1;
  const r1 = await leader.post("/teams/A-T01/reviews/review-1/submissions", { projectTitle: "T", problemStatement: "p", objectives: "o", requirementsStatus: "completed" });
  await g.post(`/submissions/${r1.body.submission.id}/review`, { decision: "approved" });
  const ms = ["requirements", "frontend", "backend", "database", "integration", "testing"].map((key) => ({ key, status: "completed" }));
  await leader.post("/teams/A-T01/reviews/review-2/submissions", { summary: "s", milestones: ms });
  await (await w.api(w.users.st[1])).post("/teams/A-T01/reviews/review-2/contributions", { summary: "mine", tasks: [] });
  const b = await (await w.api(w.users.st[4])).post("/teams/B-T01/reviews/review-1/submissions", { projectTitle: "B", problemStatement: "p", objectives: "o", requirementsStatus: "completed" });
  await g.post(`/submissions/${b.body.submission.id}/review`, { decision: "changes_required", feedback: "fix it please" });

  const d = (await hod.get("/dashboard")).body;
  // expected values from the established per-team logic
  const teams = await Team.find({ status: "active" }).populate("section", "name").populate("guide", "name").lean();
  const progress = await computeProgress(teams);
  const exp = { current: {}, noMilestones: 0, reports: 0, awaiting: 0 };
  for (const t of teams) {
    const p = progress.get(String(t._id));
    const k = p.currentReview?.key || "all_approved";
    exp.current[k] = (exp.current[k] || 0) + 1;
    if (!p.milestones.recorded) exp.noMilestones++;
    if (p.reportStatus === "approved") exp.reports++;
    exp.awaiting += p.reviews.filter((r) => ["submitted", "under_review"].includes(r.status)).length;
  }
  assert.equal(d.teamCount, teams.length);
  for (const [k, v] of Object.entries(exp.current)) assert.equal(d.teamsByCurrentReview[k], v, `teams whose current review is ${k}`);
  assert.equal(d.teamsWithoutMilestoneRecord, exp.noMilestones);
  assert.equal(d.reportsApproved, exp.reports);
  assert.equal(d.awaitingGuideReview, exp.awaiting);
  assert.equal(d.contributionsPending, 1);
  for (const s of d.sections) {
    const st = teams.filter((t) => String(t.section._id) === s.id);
    assert.equal(s.teams, st.length);
    assert.equal(s.reviewsApproved, st.reduce((n, t) => n + progress.get(String(t._id)).reviewsApproved, 0));
    assert.equal(s.reviewsTotal, st.reduce((n, t) => n + progress.get(String(t._id)).reviewsTotal, 0));
  }
  const gd = (await g1.get("/dashboard")).body;
  assert.equal(gd.awaitingCorrection, 1, "guide sees the team that must correct");
  assert.equal(gd.teamCount, 2);
  const cd = (await coordA.get("/dashboard")).body; // regression: aggregation scope must use ObjectIds, not strings
  assert.equal(cd.teamCount, 2, "coordinator of section A sees section A's two teams");
  assert.equal(cd.sections.length, 1);
  assert.equal(cd.sections[0].teams, 2);
  assert.equal(cd.awaitingGuideReview, 1);
  assert.equal((await coordB.get("/dashboard")).body.teamCount, 1);
  assert.equal((await g2.get("/dashboard")).body.teamCount, 1);
});

let bulkReady;
/** Seeds the large data set once (raw inserts for speed). Called by every test that needs it, after the small-world test. */
function seedBulk() {
  bulkReady ??= (async () => {
  const A = w.A._id, B = w.B._id, guide1 = w.users.g1._id, guide2 = w.users.g2._id;
  await col("users").insertMany(Array.from({ length: bigStudents }, (_, i) => ({ _id: oid(), name: `Bulk Student ${String(i).padStart(3, "0")}`, email: `bulk${i}@t.edu`, role: "student", rollNumber: `BS${String(i).padStart(3, "0")}`, section: i % 2 ? A : B, team: null, isActive: true, tokenVersion: 0, sections: [], createdAt: now, updatedAt: now })));
  const teams = Array.from({ length: bigTeams }, (_, i) => ({ _id: oid(), teamId: `P-T${String(i).padStart(3, "0")}`, section: i % 2 ? A : B, guide: i % 3 ? guide1 : guide2, leader: null, projectTitle: i % 5 === 0 ? `Project ${i}` : "", titleStatus: "not_submitted", titleHistory: [], status: i % 50 === 49 ? "archived" : "active", createdAt: now, updatedAt: now }));
  await col("teams").insertMany(teams);
  global.__bulkTeams = teams;
  const slots = Array.from({ length: bigSlots }, (_, i) => ({ _id: oid(), guide: guide1, section: null, reviewKey: i % 2 ? "review-2" : "review-3", date: futureDate(1 + Math.floor(i / 50)), startMin: 480 + (i % 50) * 5, endMin: 485 + (i % 50) * 5, status: "available", bookedTeam: null, createdAt: now, updatedAt: now }));
  await col("bookingslots").insertMany(slots);
  global.__bulkSlots = slots;
  // 360 booking requests: first 100 pending (active), the rest rejected (inactive) so the unique indexes are respected
  await col("bookingrequests").insertMany(teams.map((t, i) => ({ _id: oid(), slot: slots[i]._id, team: t._id, section: t.section, guide: t.guide, reviewKey: "review-2", requestedBy: w.users.st[0]._id, status: i < 100 ? "pending" : "rejected", active: i < 100, overridden: false, history: [], createdAt: new Date(now.getTime() + i * 1000), updatedAt: now })));
  await col("bookingslots").updateMany({ _id: { $in: slots.slice(0, 100).map((s) => s._id) } }, { $set: { status: "pending" } });
  })();
  return bulkReady;
}

test("People: more than 200 users are reachable page by page; filters + search combine with paging; limit is clamped", async () => {
  await seedBulk();
  const all = await walk(hod, "/users?status=all", "users", 50);
  assert.ok(all.total > 200, `total ${all.total}`);
  const clamp = await hod.get("/users?limit=1000");
  assert.equal(clamp.body.limit, 200);
  assert.equal(clamp.body.users.length, 200);
  const filtered = await walk(hod, `/users?role=student&section=${w.A._id}&search=Bulk%20Student`, "users", 25);
  assert.equal(filtered.total, bigStudents / 2);
  assert.ok(filtered.rows.every((u) => u.section.id === String(w.A._id) && /Bulk Student/.test(u.name)));
  const page2 = await hod.get(`/users?role=student&section=${w.A._id}&search=Bulk%20Student&limit=25&page=2`);
  assert.equal(page2.body.total, bigStudents / 2, "total is independent of the page");
  assert.equal(page2.body.page, 2);
  const lastPage = await hod.get(`/users?role=student&section=${w.A._id}&search=Bulk%20Student&limit=25&page=6`);
  assert.equal(lastPage.body.users.length, bigStudents / 2 - 125, "partial final page");
});

test("People: authorisation scope applies on every page (coordinator sees only own-section students; students and guides cannot list)", async () => {
  await seedBulk();
  const mine = await walk(coordA, "/users?role=student", "users", 40);
  assert.ok(mine.rows.every((u) => u.section.id === String(w.A._id)));
  assert.equal(mine.total, await User.countDocuments({ role: "student", isActive: true, section: w.A._id }));
  for (const c of [studentA, g1]) assert.equal((await c.get("/users?limit=10&page=3")).status, 403);
});

test("Teams: more than 200 teams are reachable; combinations of search/section/status with paging keep exact totals", async () => {
  await seedBulk();
  const all = await walk(hod, "/teams?withProgress=false", "teams", 200);
  const active = await Team.countDocuments({ status: "active" });
  assert.ok(active > 200);
  assert.equal(all.total, active);
  const bySearch = await walk(hod, `/teams?search=P-T0&section=${w.A._id}&withProgress=false`, "teams", 30);
  assert.equal(bySearch.total, await Team.countDocuments({ status: "active", teamId: /P-T0/, section: w.A._id }));
  const archived = await walk(hod, "/teams?status=archived&withProgress=false", "teams", 5);
  assert.equal(archived.total, Math.floor(bigTeams / 50), "teams 49, 99, … are archived");
  const withProgress = await hod.get("/teams?limit=25&page=2");
  assert.equal(withProgress.body.teams.length, 25);
  assert.ok(withProgress.body.teams.every((t) => t.progress && t.memberCount !== undefined), "progress is still computed for the page");
});

test("Teams: scope holds on every page for every role", async () => {
  await seedBulk();
  const g2all = await walk(g2, "/teams?withProgress=false", "teams", 25);
  assert.ok(g2all.rows.every((t) => t.guide.id === String(w.users.g2._id)));
  const cb = await walk(coordB, "/teams?withProgress=false", "teams", 40);
  assert.ok(cb.rows.every((t) => t.section.id === String(w.B._id)));
  const st = await studentA.get("/teams?limit=1&page=1");
  assert.deepEqual(st.body.teams.map((t) => t.teamId), ["A-T01"]);
  assert.equal(st.body.total, 1);
});

test("Booking slots: more than 500 are reachable; filters + paging; stable order; scope per role", async () => {
  await seedBulk();
  const all = await walk(g1, "/bookings/slots", "slots", 200);
  assert.ok(all.total > 500, `total ${all.total}`);
  const sorted = [...all.rows].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  assert.deepEqual(all.rows.map((r) => r.id).slice(0, 5), sorted.map((r) => r.id).slice(0, 5), "ordered by date then time");
  const r2 = await walk(g1, "/bookings/slots?reviewKey=review-2&status=available", "slots", 60);
  assert.equal(r2.total, bigSlots / 2 - 50, "only available review-2 slots (the 50 pending ones are excluded)");
  assert.ok(r2.rows.every((s) => s.reviewKey === "review-2" && s.status === "available"));
  const student = await walk(studentA, "/bookings/slots?status=available", "slots", 100);
  assert.ok(student.rows.every((s) => s.guide.id === String(w.users.g1._id)), "a student only sees their own guide's slots");
  assert.equal(student.total, bigSlots - 100);
  assert.equal((await g2.get("/bookings/slots")).body.total, 0, "another guide sees none of them");
  // coordinators see section-less slots of guides who have teams in their section (guide 1 has teams in A and B)
  assert.equal((await coordB.get("/bookings/slots")).body.total, bigSlots);
  assert.equal((await coordA.get("/bookings/slots")).body.total, bigSlots);
  // ...but a coordinator of a section where that guide has no teams sees none of them
  const C = await Section.create({ name: "C" });
  const coordC = await User.create({ name: "Coord C", email: "cc@t.edu", role: "coordinator", sections: [C._id] });
  assert.equal((await (await w.api(coordC)).get("/bookings/slots")).body.total, 0);
});

test("Booking requests: more than 300 are reachable; filters + paging; scope per role", async () => {
  await seedBulk();
  const all = await walk(hod, "/bookings/requests", "requests", 100);
  assert.equal(all.total, bigTeams, "all 360, not capped at 300");
  const pending = await walk(hod, "/bookings/requests?status=pending", "requests", 40);
  assert.equal(pending.total, 100);
  const created = all.rows.map((r) => r.createdAt);
  assert.deepEqual(created, [...created].sort().reverse(), "newest first across pages");
  const g2seen = await walk(g2, "/bookings/requests", "requests", 50);
  assert.ok(g2seen.total > 0 && g2seen.total < bigTeams);
  const teamsOfG2 = new Set((await Team.find({ guide: w.users.g2._id }, "_id").lean()).map((t) => String(t._id)));
  assert.ok(g2seen.rows.every((r) => teamsOfG2.has(r.team.id)), "a guide only sees requests of their own teams");
  const coordAseen = await walk(coordA, "/bookings/requests", "requests", 50);
  assert.equal(coordAseen.total, bigTeams / 2);
  assert.equal((await studentA.get("/bookings/requests")).body.total, 0, "student sees only their own team's requests");
});

test("Dashboard totals are exact above 2,000 teams (no cap) and independent of any page size", async () => {
  await seedBulk();
  const A = w.A._id, B = w.B._id, g = w.users.g1._id;
  const extra = Array.from({ length: 2100 }, (_, i) => ({ _id: oid(), teamId: `Z-T${String(i).padStart(4, "0")}`, section: i % 2 ? A : B, guide: g, leader: null, projectTitle: "", titleStatus: "not_submitted", titleHistory: [], status: "active", createdAt: now, updatedAt: now }));
  await col("teams").insertMany(extra);
  const expected = await Team.countDocuments({ status: "active" });
  assert.ok(expected > 2400);
  const t0 = Date.now();
  const d = (await hod.get("/dashboard")).body;
  const ms = Date.now() - t0;
  assert.equal(d.teamCount, expected, "all teams counted, none dropped");
  assert.equal(Object.values(d.teamsByCurrentReview).reduce((a, b) => a + b, 0), expected, "distribution sums to the total");
  assert.equal(d.sections.reduce((n, s) => n + s.teams, 0), expected);
  assert.equal(d.teamsWithoutMilestoneRecord, expected - 1, "all but the one team with a progress record");
  const ca = (await coordA.get("/dashboard")).body;
  assert.equal(ca.teamCount, await Team.countDocuments({ status: "active", section: w.A._id }), "coordinator total is section-scoped");
  const gd = (await g2.get("/dashboard")).body;
  assert.equal(gd.teamCount, await Team.countDocuments({ status: "active", guide: w.users.g2._id }));
  console.log(`      dashboard over ${expected} teams answered in ${ms} ms`);
  assert.ok(ms < 8000, `dashboard took ${ms} ms`);
});
