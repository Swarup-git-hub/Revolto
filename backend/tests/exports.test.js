import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { buildWorld, startApp } from "./helpers.js";
import Team from "../src/models/Team.js";
import AuditLog from "../src/models/AuditLog.js";

let app, w, hod, coordA, coordB, g1, g2, leader;
before(async () => {
  app = await startApp("exports");
  w = await buildWorld(app.url);
  [hod, coordA, coordB, g1, g2, leader] = await Promise.all([w.users.hod, w.users.coordA, w.users.coordB, w.users.g1, w.users.g2, w.users.st[0]].map((u) => w.api(u)));
  const ms = ["requirements", "frontend", "backend", "database", "integration", "testing"].map((key, i) => ({ key, status: i < 2 ? "completed" : "not_started" }));
  await leader.post("/teams/A-T01/reviews/review-2/submissions", { summary: "going well", milestones: ms });
  await Team.updateOne({ _id: w.teams.tA1._id }, { $set: { projectTitle: '=HYPERLINK("http://evil","x")' } });
  await (await w.api(w.users.st[1])).post("/teams/A-T01/reviews/review-2/contributions", { summary: "my part", tasks: [] });
});
after(() => app.stop());

const rows = (text) => text.replace(/^\uFEFF/, "").split("\n").filter((l) => !l.startsWith("#") && l.trim());

test("team CSV: scoped by role, with generation time and filter context, only recorded data", async () => {
  const r = await hod.raw("/exports/teams.csv");
  assert.equal(r.status, 200);
  const text = r.buffer.toString();
  assert.match(text, /# Generated: \d{4}-\d{2}-\d{2}T/);
  assert.match(text, /# Filters: None/);
  const lines = rows(text);
  assert.equal(lines.length, 4, "header + 3 teams");
  assert.match(lines[0], /"Team ID","Project title","Section","Guide","Member count","Current review","Progress status","Completed milestones","Pending work","Guide review status","Last update"/);
  const a1 = lines.find((l) => l.includes("A-T01"));
  assert.match(a1, /2 of 6 milestones/);
  assert.match(a1, /Requirements; Frontend \/ UI/);
  const a2 = lines.find((l) => l.includes("A-T02"));
  assert.match(a2, /Not recorded/, "nothing fabricated for teams with no data");
  assert.ok(!text.includes('"=HYPERLINK'), "formula injection neutralised");
  assert.match(text, /'=HYPERLINK/);
});

test("exports respect scope at generation time", async () => {
  const teamsOf = async (c, q = "") => rows((await c.raw(`/exports/teams.csv${q}`)).buffer.toString()).slice(1).map((l) => /"(\w-T\d+)"/.exec(l)[1]).sort();
  assert.deepEqual(await teamsOf(coordA), ["A-T01", "A-T02"]);
  assert.deepEqual(await teamsOf(coordB), ["B-T01"]);
  assert.deepEqual(await teamsOf(g1), ["A-T01", "B-T01"]);
  assert.deepEqual(await teamsOf(g2), ["A-T02"]);
  assert.equal((await coordA.raw(`/exports/teams.csv?section=${w.B._id}`)).status, 403, "coordinator cannot request another section");
  assert.deepEqual(await teamsOf(g1, `?section=${w.B._id}`), ["B-T01"]);
  assert.deepEqual(await teamsOf(g2, `?guide=${w.users.g1._id}`), [], "a guide cannot widen scope with a filter");
  assert.equal((await (await w.api(w.users.st[0])).raw("/exports/teams.csv")).status, 403);
  assert.equal((await w.anon.get("/exports/teams.csv")).status, 401);
});

test("filters: guide, team, review progress and submission status", async () => {
  const names = async (q) => rows((await hod.raw(`/exports/teams.csv?${q}`)).buffer.toString()).slice(1).map((l) => /"(\w-T\d+)"/.exec(l)[1]).sort();
  assert.deepEqual(await names(`guide=${w.users.g2._id}`), ["A-T02"]);
  assert.deepEqual(await names("team=b-t01"), ["B-T01"]);
  assert.deepEqual(await names("progress=in_progress"), ["A-T01"]);
  assert.deepEqual(await names("progress=not_recorded"), ["A-T02", "B-T01"]);
  assert.deepEqual(await names("review=review-2&submissionStatus=submitted"), ["A-T01"]);
  assert.equal((await hod.raw("/exports/teams.csv?progress=bogus")).status, 400);
  const filtered = (await hod.raw(`/exports/teams.csv?section=${w.A._id}&progress=in_progress`)).buffer.toString();
  assert.match(filtered, /# Filters: Section: A; Progress: in_progress/);
});

test("student CSV lists recorded contributions without verifying them", async () => {
  const text = (await g1.raw("/exports/students.csv")).buffer.toString();
  const lines = rows(text);
  assert.match(lines[0], /"Roll number","Name","Section","Team ID","Project title","Guide","Recorded contributions","Contribution status","Contribution review","Contribution summary","Contribution tasks","Final report status","Guide feedback status"/);
  assert.equal(lines.length, 5, "header + 4 students of guide 1's teams");
  assert.match(lines.find((l) => l.includes('"R2"')), /"1","Pending review \(self-reported\)"/);
  assert.match(lines.find((l) => l.includes('"R1"')), /"0","Not recorded"/);
});

test("Excel workbook has Team-wise and Student-wise sheets with context rows; exports are audited", async () => {
  const r = await coordA.raw("/exports/progress.xlsx");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /spreadsheetml/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(r.buffer);
  assert.deepEqual(wb.worksheets.map((s) => s.name), ["Team-wise Progress", "Student-wise Progress"]);
  const t = wb.getWorksheet("Team-wise Progress");
  assert.match(String(t.getRow(1).getCell(1).value), /^Generated: /);
  assert.match(String(t.getRow(2).getCell(1).value), /^Filters applied: /);
  assert.equal(t.getRow(4).getCell(1).value, "Team ID");
  assert.equal(t.rowCount, 4 + 2, "two teams in section A");
  assert.equal(wb.getWorksheet("Student-wise Progress").rowCount, 4 + 4);
  assert.ok(await AuditLog.findOne({ action: "EXPORT", entityName: "progress.xlsx", actorRole: "coordinator" }));
});
