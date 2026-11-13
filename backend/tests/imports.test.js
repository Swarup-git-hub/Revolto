import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { buildWorld, startApp } from "./helpers.js";
import User from "../src/models/User.js";
import Team from "../src/models/Team.js";
import ImportJob from "../src/models/ImportJob.js";

let app, w, hod, coordA;
before(async () => { app = await startApp("imports"); w = await buildWorld(app.url); hod = await w.api(w.users.hod); coordA = await w.api(w.users.coordA); });
after(() => app.stop());

const csvFile = (text, name = "students.csv") => ({ name, buffer: Buffer.from(text) });
const upload = (c, type, file) => c.upload(`/imports/${type}/preview`, {}, file);

test("template downloads (xlsx and csv) contain the expected columns", async () => {
  const x = await hod.raw("/imports/templates/students?format=xlsx");
  assert.equal(x.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(x.buffer);
  assert.deepEqual(wb.worksheets[0].getRow(1).values.slice(1), ["rollNumber", "name", "email", "section", "phone"]);
  const c = await hod.raw("/imports/templates/teams?format=csv");
  assert.match(c.buffer.toString(), /^teamId,section,guideEmail,/);
  assert.equal((await (await w.api(w.users.g1)).raw("/imports/templates/students")).status, 403);
  assert.equal((await coordA.raw("/imports/templates/staff")).status, 403, "staff import is HOD only");
});

test("preview validates rows, detects duplicates, and writes nothing", async () => {
  const text = [
    "rollNumber,name,email,section,phone",
    "N001,New One,new1@t.edu,A,",
    "N002,New Two,new2@t.edu,A,9999999999",
    "R1,Clash Roll,clash@t.edu,A,",          // roll exists
    "N003,Clash Mail,s2@t.edu,A,",           // email exists
    "N001,Dup In File,new9@t.edu,A,",        // roll repeated in file
    "N004,Bad Email,not-an-email,A,",
    "N005,No Section,n5@t.edu,Z,",
    "N006,Other Section,n6@t.edu,B,",        // coordinator A not assigned to B
  ].join("\n");
  const before = await User.countDocuments();
  const r = await upload(coordA, "students", csvFile(text));
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.summary, { total: 8, valid: 2, errors: 3, duplicates: 3 });
  const byRow = Object.fromEntries(r.body.rows.map((x) => [x.rowNumber, x]));
  assert.equal(byRow[4].status, "duplicate");
  assert.match(byRow[4].errors[0], /unchanged/);
  assert.equal(byRow[7].status, "error");
  assert.match(byRow[9].errors[0], /not assigned/);
  assert.equal(await User.countDocuments(), before, "preview is read-only");
  const errs = await coordA.raw(`/imports/jobs/${r.body.id}/errors.csv`);
  assert.equal(errs.status, 200);
  assert.equal(errs.buffer.toString().trim().split("\n").length, 7, "header + 6 problem rows");
});

test("confirm is explicit, applies only valid rows, never overwrites, and cannot run twice", async () => {
  const text = "rollNumber,name,email,section,phone\nN101,Fresh,fresh@t.edu,A,\nR1,Overwrite Attempt,over@t.edu,A,\n";
  const r = await upload(coordA, "students", csvFile(text));
  assert.equal((await coordA.post(`/imports/jobs/${r.body.id}/confirm`, {})).status, 400, "needs confirm:true");
  assert.equal((await hod.post(`/imports/jobs/${r.body.id}/confirm`, { confirm: true })).status, 404, "another user's job");
  const c = await coordA.post(`/imports/jobs/${r.body.id}/confirm`, { confirm: true });
  assert.equal(c.status, 200);
  assert.deepEqual([c.body.result.created, c.body.result.skipped, c.body.result.failed], [1, 1, 0]);
  assert.equal((await User.findOne({ rollNumber: "R1" })).name, "Student 1", "existing record untouched");
  assert.equal((await User.findOne({ rollNumber: "N101" })).section.toString(), String(w.A._id));
  assert.equal((await coordA.post(`/imports/jobs/${r.body.id}/confirm`, { confirm: true })).status, 400);
  assert.equal((await ImportJob.findById(r.body.id).lean()).expireAt, undefined, "confirmed jobs are kept (TTL field removed)");
});

test("xlsx upload works and unsupported / malformed files are refused", async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("s");
  ws.addRow(["rollNumber", "name", "email", "section", "phone"]);
  ws.addRow(["N201", "Excel Student", "xl@t.edu", "A", ""]);
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const r = await upload(coordA, "students", { name: "s.xlsx", buffer });
  assert.equal(r.status, 201);
  assert.equal(r.body.summary.valid, 1);
  assert.equal((await upload(coordA, "students", { name: "s.txt", buffer: Buffer.from("x") })).status, 400);
  assert.equal((await upload(coordA, "students", csvFile("a,b\n1,2"))).status, 400, "missing required columns");
});

test("team import checks guide workload, membership, section and in-file reuse", async () => {
  await User.create([{ name: "T1", email: "t1@t.edu", role: "student", rollNumber: "TT1", section: w.A._id }, { name: "T2", email: "t2@t.edu", role: "student", rollNumber: "TT2", section: w.A._id }, { name: "T3", email: "t3@t.edu", role: "student", rollNumber: "TT3", section: w.A._id }]);
  const text = [
    "teamId,section,guideEmail,projectTitle,leaderRoll,memberRolls",
    ",A,g2@t.edu,Import Project,TT1,TT1;TT2",
    ",A,g2@t.edu,Reuses TT2,TT2,TT2",           // student already used earlier in file
    ",A,g1@t.edu,Taken member,R1,R1",           // R1 already in a team
    "A-T01,A,g2@t.edu,Dup id,TT3,TT3",          // team id exists
    ",A,nobody@t.edu,No guide,TT3,TT3",
  ].join("\n");
  const r = await upload(coordA, "teams", csvFile(text, "teams.csv"));
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.rows.map((x) => x.status), ["valid", "duplicate", "duplicate", "duplicate", "error"]);
  const c = await coordA.post(`/imports/jobs/${r.body.id}/confirm`, { confirm: true });
  assert.equal(c.body.result.created, 1);
  const team = await Team.findOne({ projectTitle: "Import Project" });
  assert.match(team.teamId, /^A-T\d+$/);
  assert.equal(String(team.guide), String(w.users.g2._id));
  assert.equal(await User.countDocuments({ team: team._id }), 2);
  assert.equal((await User.findOne({ rollNumber: "TT1" })).team.toString(), String(team._id));
  assert.equal(String(team.leader), String((await User.findOne({ rollNumber: "TT1" }))._id));
});

test("staff import (HOD only) creates guides and coordinators; duplicates skipped", async () => {
  const text = "name,email,role,sections\nNew Guide,ng@t.edu,guide,\nNew Coord,nc@t.edu,coordinator,B\nDup,g1@t.edu,guide,\nBad,bad@t.edu,student,";
  const r = await upload(hod, "staff", csvFile(text, "staff.csv"));
  assert.deepEqual(r.body.summary, { total: 4, valid: 2, errors: 1, duplicates: 1 });
  await hod.post(`/imports/jobs/${r.body.id}/confirm`, { confirm: true });
  assert.equal((await User.findOne({ email: "nc@t.edu" })).sections[0].toString(), String(w.B._id));
  assert.equal((await User.findOne({ email: "g1@t.edu" })).name, "Guide One");
});
