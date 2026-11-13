import { Router } from "express";
import ImportJob from "../../models/ImportJob.js";
import { audit } from "../../shared/audit.js";
import { authorize, protect } from "../../shared/auth.js";
import { asyncHandler, badRequest, forbidden, notFound } from "../../shared/errors.js";
import { importUpload } from "../../shared/upload.js";
import { parseId } from "../../shared/validate.js";
import { TYPES, applyRows, buildTemplate, parseFile, validateRows } from "./imports.service.js";

const router = Router();
router.use(protect, authorize("hod", "coordinator"));

const typeOf = (req) => {
  const t = req.params.type;
  if (!TYPES[t]) throw notFound("Unknown import type");
  if (!TYPES[t].roles.includes(req.user.role)) throw forbidden("You cannot import this kind of record");
  return t;
};

router.get("/templates/:type", asyncHandler(async (req, res) => {
  const type = typeOf(req);
  const format = req.query.format === "csv" ? "csv" : "xlsx";
  const t = await buildTemplate(type, format);
  res.setHeader("Content-Type", t.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${type}-template.${t.ext}"`);
  res.send(t.buffer);
}));

const summaryOf = (job) => ({ id: String(job._id), type: job.type, fileName: job.fileName, status: job.status, summary: job.summary, result: job.result });
const rowView = (r) => ({ rowNumber: r.rowNumber, status: r.status, errors: r.problems, raw: r.raw });

router.post("/:type/preview", (req, res, next) => importUpload(req, res, next), asyncHandler(async (req, res) => {
  const type = typeOf(req);
  if (!req.file) throw badRequest("Choose a file to upload");
  const rows = await parseFile(type, req.file);
  const validated = await validateRows(type, rows, req.user);
  const summary = { total: validated.length, valid: validated.filter((r) => r.status === "valid").length, errors: validated.filter((r) => r.status === "error").length, duplicates: validated.filter((r) => r.status === "duplicate").length };
  const job = await ImportJob.create({ type, createdBy: req.user._id, fileName: String(req.file.originalname).slice(0, 120), rows: validated.map((r) => ({ rowNumber: r.rowNumber, status: r.status, problems: r.errors, raw: r.raw, normalized: r.normalized })), summary });
  res.status(201).json({ ...summaryOf(job), rows: job.rows.slice(0, 300).map(rowView), truncated: job.rows.length > 300 });
}));

async function loadJob(req) {
  const job = await ImportJob.findOne({ _id: parseId(req.params.id), createdBy: req.user._id });
  if (!job) throw notFound("Import not found or expired");
  return job;
}

router.get("/jobs/:id", asyncHandler(async (req, res) => {
  const job = await loadJob(req);
  res.json({ ...summaryOf(job), rows: job.rows.slice(0, 300).map(rowView), truncated: job.rows.length > 300 });
}));

/** Error / duplicate report as CSV so it can be fixed and re-uploaded. */
router.get("/jobs/:id/errors.csv", asyncHandler(async (req, res) => {
  const job = await loadJob(req);
  const cols = TYPES[job.type].columns;
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`;
  const lines = [["row", "status", "problems", ...cols].map(q).join(",")];
  for (const r of job.rows.filter((x) => x.status !== "valid")) lines.push([r.rowNumber, r.status, r.problems.join(" | "), ...cols.map((c) => r.raw?.[c])].map(q).join(","));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${job.type}-import-errors.csv"`);
  res.send(lines.join("\n"));
}));

router.post("/jobs/:id/confirm", asyncHandler(async (req, res) => {
  if (req.body?.confirm !== true) throw badRequest("Confirmation is required", { confirm: "Send confirm: true after reviewing the preview" });
  const job = await loadJob(req);
  if (job.status === "confirmed") throw badRequest("This import was already confirmed");
  if (!TYPES[job.type].roles.includes(req.user.role)) throw forbidden();
  job.status = "confirmed"; // claim first so a double-click cannot apply twice
  const claimed = await ImportJob.updateOne({ _id: job._id, status: "previewed" }, { $set: { status: "confirmed", confirmedAt: new Date() }, $unset: { expireAt: 1 } });
  if (!claimed.modifiedCount) throw badRequest("This import was already confirmed");
  const result = await applyRows(job.type, job, req.user);
  await ImportJob.updateOne({ _id: job._id }, { $set: { result } });
  await audit(req.user, { action: "IMPORT", entity: "ImportJob", entityId: job._id, entityName: `${job.type} import (${job.fileName})`, after: { summary: job.summary, result: { created: result.created, skipped: result.skipped, failed: result.failed } }, ip: req.ip });
  res.json({ id: String(job._id), status: "confirmed", summary: job.summary, result });
}));

export default router;
