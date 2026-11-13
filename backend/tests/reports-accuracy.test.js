import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { buildWorld, startApp } from "./helpers.js";

let app, w, hod, coordA, g1, g2, leader, member, ms;
before(async () => {
  app = await startApp("reportacc");
  w = await buildWorld(app.url);
  [hod, coordA, g1, g2, leader, member] = await Promise.all([w.users.hod, w.users.coordA, w.users.g1, w.users.g2, w.users.st[0], w.users.st[1]].map((u) => w.api(u)));
  ms = (n) => ["requirements", "frontend", "backend", "database", "integration", "testing"].map((key, i) => ({ key, status: i < n ? "completed" : "not_started" }));

  // A-T01: Review 1 approved; Review 2 submitted (still awaiting the guide) → "current review" is Review 2
  const r1 = await leader.post("/teams/A-T01/reviews/review-1/submissions", { projectTitle: "Attendance", problemStatement: "p", objectives: "o", requirementsStatus: "completed" });
  await g1.post(`/submissions/${r1.body.submission.id}/review`, { decision: "approved" });
  await leader.post("/teams/A-T01/reviews/review-2/submissions", { summary: "going well", milestones: ms(2) });

  // contributions: leader records two versions (latest starts with a formula), member one that the guide acknowledges
  await leader.post("/teams/A-T01/reviews/review-2/contributions", { summary: "first draft", tasks: [] });
  await leader.post("/teams/A-T01/reviews/review-2/contributions", { summary: "=SUM(1,2) built login", tasks: [{ milestoneKey: "frontend", description: "Login page", status: "completed", percent: 100 }, { milestoneKey: "backend", description: "Auth API", status: "in_progress" }] });
  const mc = await member.post("/teams/A-T01/reviews/review-2/contributions", { summary: "wrote the database schema", tasks: [{ milestoneKey: "database", description: "Schema design", status: "completed" }] });
  await g1.post(`/contributions/${mc.body.contribution.id}/review`, { decision: "acknowledged" });

  // a review that exists for section A only → section B teams do not have it
  const mk = await hod.post("/reviews/config", { key: "review-x", name: "Review X — Section A pilot", order: 9, type: "improvements", section: String(w.A._id) });
  assert.equal(mk.status, 201);
});
after(() => app.stop());

const lines = (text) => text.replace(/^\uFEFF/, "").split("\n").filter((l) => l.trim() && !l.startsWith("#"));
const metaLines = (text) => text.replace(/^\uFEFF/, "").split("\n").filter((l) => l.startsWith("#"));
const cells = (line) => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"'));
const table = (text) => { const [h, ...rows] = lines(text); const cols = cells(h); return rows.map((r) => Object.fromEntries(cells(r).map((c, i) => [cols[i], c]))); };
const csv = async (c, path) => (await c.raw(path)).buffer.toString();
const byTeam = (rows, id) => rows.find((r) => r["Team ID"] === id);

test("review filter is an EXACT match: Review 1 status is reported for Review 1, not the team's current Review 2", async () => {
  const none = table(await csv(hod, "/exports/teams.csv"));
  assert.match(byTeam(none, "A-T01")["Current review"], /Review 2/);
  assert.equal(byTeam(none, "A-T01")["Guide review status"], "Submitted");

  const r1 = table(await csv(hod, "/exports/teams.csv?review=review-1&section=" + w.A._id));
  assert.match(byTeam(r1, "A-T01")["Current review"], /Review 1/, "shows the selected review");
  assert.equal(byTeam(r1, "A-T01")["Guide review status"], "Approved", "status of Review 1, not the fallback");
  assert.equal(byTeam(r1, "A-T02")["Guide review status"], "Not submitted");

  const r2 = table(await csv(hod, "/exports/teams.csv?review=review-2&section=" + w.A._id));
  assert.equal(byTeam(r2, "A-T01")["Guide review status"], "Submitted");
  assert.match(byTeam(r2, "A-T02")["Current review"], /Review 2/);
});

test("review-specific submission-status filter uses the selected review only", async () => {
  const approvedR1 = table(await csv(hod, "/exports/teams.csv?review=review-1&submissionStatus=approved"));
  assert.deepEqual(approvedR1.map((r) => r["Team ID"]), ["A-T01"]);
  const approvedR2 = table(await csv(hod, "/exports/teams.csv?review=review-2&submissionStatus=approved"));
  assert.deepEqual(approvedR2, [], "nothing approved for Review 2 even though Review 1 was");
});

test("a review not available to a team is not silently replaced: those teams are excluded and the export says so", async () => {
  const text = await csv(hod, "/exports/teams.csv?review=review-x");
  const rows = table(text);
  assert.deepEqual(rows.map((r) => r["Team ID"]).sort(), ["A-T01", "A-T02"], "only section A has review-x");
  assert.ok(rows.every((r) => /Review X/.test(r["Current review"]) && r["Guide review status"] === "Not submitted"));
  assert.match(metaLines(text).join("\n"), /Note: 1 team\(s\) excluded/);
  const students = await csv(hod, "/exports/students.csv?review=review-x");
  assert.ok(table(students).every((r) => r["Team ID"].startsWith("A-")), "students of excluded teams are excluded too");
  assert.match(metaLines(students).join("\n"), /excluded/);
  // coordinator of section B: nobody has the review → empty, with the note
  const b = await csv(await w.api(w.users.coordB), "/exports/teams.csv?review=review-x");
  assert.deepEqual(table(b), []);
  assert.match(metaLines(b).join("\n"), /1 team\(s\) excluded/);
});

test("invalid review filters are rejected (CSV and Excel)", async () => {
  for (const p of ["/exports/teams.csv", "/exports/students.csv", "/exports/progress.xlsx"]) {
    const r = await hod.raw(`${p}?review=review-99`);
    assert.equal(r.status, 400, p);
    assert.match(r.buffer.toString(), /Unknown review/);
  }
  assert.equal((await hod.raw("/exports/teams.csv?review=%3Cscript%3E")).status, 400);
});

test("Excel is review-specific too and carries the exclusion note in the context rows", async () => {
  const r = await hod.raw(`/exports/progress.xlsx?review=review-1&section=${w.A._id}`);
  assert.equal(r.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(r.buffer);
  const t = wb.getWorksheet("Team-wise Progress");
  const header = t.getRow(4).values.slice(1);
  const rowOf = (id) => { const row = t.getRows(5, t.rowCount - 4).find((x) => x.getCell(1).value === id); return Object.fromEntries(header.map((h, i) => [h, row.getCell(i + 1).value])); };
  assert.equal(rowOf("A-T01")["Guide review status"], "Approved");
  assert.match(String(t.getRow(2).getCell(1).value), /Review: review-1/);

  const x = await hod.raw("/exports/progress.xlsx?review=review-x");
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(x.buffer);
  assert.match(String(wb2.getWorksheet("Team-wise Progress").getRow(3).getCell(1).value), /^Note: 1 team\(s\) excluded/);
  assert.equal(wb2.getWorksheet("Team-wise Progress").getRow(4).getCell(1).value, "Team ID", "header row position is unchanged");
});

test("student export contains the ACTUAL recorded contribution (summary and tasks), with status and version count as separate fields", async () => {
  const rows = table(await csv(g1, "/exports/students.csv?review=review-2"));
  const s1 = rows.find((r) => r["Roll number"] === "R1");
  assert.equal(s1["Recorded contributions"], "2", "version count is its own field");
  assert.equal(s1["Contribution status"], "Pending review (self-reported)", "status is its own field");
  assert.match(s1["Contribution review"], /Review 2/);
  assert.match(s1["Contribution summary"], /built login/, "latest version content");
  assert.ok(!/first draft/.test(s1["Contribution summary"]), "older version is not exported as current");
  assert.equal(s1["Contribution tasks"], "Frontend / UI: Login page (completed); Backend: Auth API (in progress)");
  const s2 = rows.find((r) => r["Roll number"] === "R2");
  assert.equal(s2["Contribution status"], "Acknowledged by guide");
  assert.equal(s2["Recorded contributions"], "1");
  assert.equal(s2["Contribution summary"], "wrote the database schema");
  assert.equal(s2["Contribution tasks"], "Database: Schema design (completed)");
});

test("missing contributions are shown as 'Not recorded' with empty content and zero versions", async () => {
  const rows = table(await csv(hod, "/exports/students.csv"));
  const none = rows.find((r) => r["Roll number"] === "R3");
  assert.deepEqual([none["Recorded contributions"], none["Contribution status"], none["Contribution summary"], none["Contribution tasks"], none["Contribution review"]], ["0", "Not recorded", "", "", ""]);
});

test("without a review filter the student's most recent contribution is shown; a review with no contribution shows none (no leakage from other reviews)", async () => {
  const all = table(await csv(hod, "/exports/students.csv"));
  assert.match(all.find((r) => r["Roll number"] === "R1")["Contribution summary"], /built login/);
  const r1 = table(await csv(hod, "/exports/students.csv?review=review-1"));
  const s1 = r1.find((r) => r["Roll number"] === "R1");
  assert.deepEqual([s1["Contribution status"], s1["Contribution summary"], s1["Recorded contributions"]], ["Not recorded", "", "0"]);
});

test("self-reported work is never labelled verified; only an explicit Guide acknowledgement changes the label", async () => {
  const text = await csv(hod, "/exports/students.csv");
  assert.ok(!/verified/i.test(text), "the word 'verified' never appears in the export");
  const statuses = new Set(table(text).map((r) => r["Contribution status"]));
  assert.deepEqual([...statuses].sort(), ["Acknowledged by guide", "Not recorded", "Pending review (self-reported)"]);
});

test("formula-injection protection still applies to the new free-text columns (CSV and Excel)", async () => {
  const text = await csv(hod, "/exports/students.csv?review=review-2");
  assert.ok(!text.includes('"=SUM'), "no raw formula cell");
  assert.match(text, /'=SUM\(1,2\) built login/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await hod.raw("/exports/progress.xlsx?review=review-2")).buffer);
  const s = wb.getWorksheet("Student-wise Progress");
  const header = s.getRow(4).values.slice(1);
  const col = header.indexOf("Contribution summary") + 1;
  const vals = s.getRows(5, s.rowCount - 4).map((r) => String(r.getCell(col).value || ""));
  assert.ok(vals.some((v) => v.startsWith("'=SUM")), "Excel cell is neutralised");
  assert.ok(!vals.some((v) => v.startsWith("=")));
});

test("scope still applies to the new content: guides and coordinators only get their own teams' contributions", async () => {
  const g2rows = table(await csv(g2, "/exports/students.csv?review=review-2"));
  assert.ok(g2rows.every((r) => r["Team ID"] === "A-T02"));
  assert.ok(!g2rows.some((r) => /built login/.test(r["Contribution summary"])));
  const coordB = table(await csv(await w.api(w.users.coordB), "/exports/students.csv?review=review-2"));
  assert.ok(coordB.every((r) => r["Section"] === "B"));
  assert.equal((await coordA.raw(`/exports/students.csv?review=review-2&section=${w.B._id}`)).status, 403);
});
