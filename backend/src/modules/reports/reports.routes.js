import { Router } from "express";
import ExcelJS from "exceljs";
import Section from "../../models/Section.js";
import User from "../../models/User.js";
import { authorize, protect } from "../../shared/auth.js";
import { asyncHandler, badRequest, forbidden } from "../../shared/errors.js";
import { audit } from "../../shared/audit.js";
import ReviewConfig from "../../models/ReviewConfig.js";
import { parseId } from "../../shared/validate.js";
import { STUDENT_COLUMNS, TEAM_COLUMNS, buildReportData } from "./reports.service.js";

const router = Router();
router.use(protect, authorize("hod", "coordinator", "guide"));

const PROGRESS = ["not_recorded", "in_progress", "completed"];
const SUBMISSION = ["not_submitted", "submitted", "under_review", "changes_required", "approved"];

async function filtersFrom(req) {
  const q = req.query;
  const f = {};
  if (q.section) f.section = parseId(q.section, "section");
  if (q.guide) f.guide = parseId(q.guide, "guide");
  if (q.team) f.team = String(q.team).slice(0, 30);
  if (q.review) {
    f.review = String(q.review).slice(0, 41);
    if (!(await ReviewConfig.exists({ key: f.review }))) throw badRequest(`Unknown review "${f.review}". Use a review key such as review-2.`);
  }
  if (q.progress) { if (!PROGRESS.includes(q.progress)) throw badRequest("Invalid progress filter"); f.progress = q.progress; }
  if (q.submissionStatus) { if (!SUBMISSION.includes(q.submissionStatus)) throw badRequest("Invalid submission status filter"); f.submissionStatus = q.submissionStatus; }
  if (req.user.role === "coordinator" && f.section && !req.user.sections.includes(f.section)) throw forbidden("You can only export your assigned sections");
  return f;
}

async function describeFilters(f) {
  const parts = [];
  if (f.section) parts.push(`Section: ${(await Section.findById(f.section, "name").lean())?.name}`);
  if (f.guide) parts.push(`Guide: ${(await User.findById(f.guide, "name").lean())?.name}`);
  if (f.team) parts.push(`Team: ${f.team}`);
  if (f.review) parts.push(`Review: ${f.review}`);
  if (f.progress) parts.push(`Progress: ${f.progress}`);
  if (f.submissionStatus) parts.push(`Submission status: ${f.submissionStatus}`);
  return parts.length ? parts.join("; ") : "None (all records in your scope)";
}

/** Neutralise spreadsheet formula injection from user-entered text. */
const safeCell = (v) => (typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
const csv = (rows, meta, cols0) => {
  const cols = Object.keys(rows[0] || cols0 || {});
  const q = (v) => `"${String(safeCell(v) ?? "").replace(/"/g, '""')}"`;
  return [...meta.map((m) => `# ${m}`), cols.map(q).join(","), ...rows.map((r) => cols.map((c) => q(r[c])).join(","))].join("\n");
};
const stamp = () => new Date().toISOString();
const exclusionNote = (meta) => (meta.excludedTeams ? `${meta.excludedTeams} team(s) excluded: the selected review is not configured for their section.` : "");

router.get("/teams.csv", asyncHandler(async (req, res) => {
  const f = await filtersFrom(req);
  const { teamRows, meta } = await buildReportData(req.user, f);
  await audit(req.user, { action: "EXPORT", entity: "Report", entityName: "teams.csv", metadata: { filters: f, rows: teamRows.length }, ip: req.ip });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="team-progress.csv"');
  res.send("\uFEFF" + csv(teamRows, [`Generated: ${stamp()}`, `Filters: ${await describeFilters(f)}`, ...(exclusionNote(meta) ? [`Note: ${exclusionNote(meta)}`] : [])], TEAM_COLUMNS));
}));

router.get("/students.csv", asyncHandler(async (req, res) => {
  const f = await filtersFrom(req);
  const { studentRows, meta } = await buildReportData(req.user, f);
  await audit(req.user, { action: "EXPORT", entity: "Report", entityName: "students.csv", metadata: { filters: f, rows: studentRows.length }, ip: req.ip });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="student-progress.csv"');
  res.send("\uFEFF" + csv(studentRows, [`Generated: ${stamp()}`, `Filters: ${await describeFilters(f)}`, ...(exclusionNote(meta) ? [`Note: ${exclusionNote(meta)}`] : [])], STUDENT_COLUMNS));
}));

router.get("/progress.xlsx", asyncHandler(async (req, res) => {
  const f = await filtersFrom(req);
  const { teamRows, studentRows, meta } = await buildReportData(req.user, f);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Review Management System";
  const desc = await describeFilters(f);
  for (const [name, rows] of [["Team-wise Progress", teamRows], ["Student-wise Progress", studentRows]]) {
    const ws = wb.addWorksheet(name);
    const cols = rows[0] ? Object.keys(rows[0]) : name.startsWith("Team") ? TEAM_COLUMNS : STUDENT_COLUMNS;
    ws.addRow([`Generated: ${stamp()}`]);
    ws.addRow([`Filters applied: ${desc}`]);
    ws.addRow(exclusionNote(meta) ? [`Note: ${exclusionNote(meta)}`] : []);
    const header = ws.addRow(cols);
    header.font = { bold: true };
    header.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDE5EB" } }));
    rows.forEach((r) => ws.addRow(cols.map((c) => safeCell(r[c]))));
    ws.columns.forEach((c) => (c.width = 22));
    ws.views = [{ state: "frozen", ySplit: 4 }];
  }
  await audit(req.user, { action: "EXPORT", entity: "Report", entityName: "progress.xlsx", metadata: { filters: f, teams: teamRows.length, students: studentRows.length }, ip: req.ip });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="progress-report.xlsx"');
  await wb.xlsx.write(res);
  res.end();
}));

export default router;
