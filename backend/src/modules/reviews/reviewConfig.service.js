import ReviewConfig from "../../models/ReviewConfig.js";
import Submission from "../../models/Submission.js";
import Contribution from "../../models/Contribution.js";
import { FILE_SIGNATURES, PROGRESS_STATUS, REVIEW_TYPES } from "../../shared/constants.js";
import { badRequest, conflict } from "../../shared/errors.js";
import { Validator } from "../../shared/validate.js";

const opt = (value, label) => ({ value, label });
const PROGRESS_OPTIONS = [opt("not_started", "Not started"), opt("in_progress", "In progress"), opt("completed", "Completed")];

export const DEFAULT_REVIEWS = [
  {
    key: "review-1",
    order: 1,
    type: "title",
    name: "Review 1 — Project Title and Initial Requirements",
    fields: [
      { key: "projectTitle", label: "Project title", kind: "text", required: true, maxLength: 200 },
      { key: "problemStatement", label: "Problem statement", kind: "longtext", required: true, maxLength: 3000 },
      { key: "objectives", label: "Objectives", kind: "longtext", required: true, maxLength: 3000 },
      { key: "requirementsStatus", label: "Initial requirements status", kind: "select", required: true, options: PROGRESS_OPTIONS },
      { key: "notes", label: "Notes (optional)", kind: "longtext", required: false, maxLength: 2000 },
    ],
  },
  {
    key: "review-2",
    order: 2,
    type: "progress",
    name: "Review 2 — Project Progress",
    individualContributions: true,
    fields: [
      { key: "summary", label: "Progress summary", kind: "longtext", required: true, maxLength: 3000 },
      { key: "notes", label: "Notes (optional)", kind: "longtext", required: false, maxLength: 2000 },
    ],
    milestones: [
      { key: "requirements", label: "Requirements" },
      { key: "frontend", label: "Frontend / UI" },
      { key: "backend", label: "Backend" },
      { key: "database", label: "Database" },
      { key: "integration", label: "Integration" },
      { key: "testing", label: "Testing" },
    ],
  },
  {
    key: "review-3",
    order: 3,
    type: "improvements",
    name: "Review 3 — Improvements & Testing",
    upload: { enabled: true, required: false, acceptedTypes: ["pdf", "docx", "zip"], maxSizeMB: 10 },
    fields: [
      { key: "newFeatures", label: "New features added", kind: "longtext", required: true, maxLength: 3000 },
      { key: "completedImprovements", label: "Completed improvements", kind: "longtext", required: true, maxLength: 3000 },
      { key: "testingStatus", label: "Testing status", kind: "select", required: true, options: PROGRESS_OPTIONS },
      { key: "issuesResolved", label: "Issues resolved", kind: "longtext", required: false, maxLength: 3000 },
      { key: "pendingWork", label: "Pending work", kind: "longtext", required: false, maxLength: 3000 },
      { key: "notes", label: "Notes (optional)", kind: "longtext", required: false, maxLength: 2000 },
    ],
  },
  {
    key: "review-4",
    order: 4,
    type: "report",
    name: "Review 4 — Final Report Submission",
    upload: { enabled: true, required: true, acceptedTypes: ["pdf"], maxSizeMB: 10 },
    fields: [{ key: "notes", label: "Notes for the reviewer (optional)", kind: "longtext", required: false, maxLength: 2000 }],
  },
];

/** Idempotent: creates the four default college-wide reviews only if they do not exist. Never edits existing ones. */
export async function ensureDefaultReviews() {
  for (const def of DEFAULT_REVIEWS) {
    await ReviewConfig.updateOne({ key: def.key, section: null, archivedAt: null }, { $setOnInsert: { ...def, section: null } }, { upsert: true });
  }
}

/** Reviews that apply to a section: a section-level config overrides the college-wide config with the same key. */
export async function getEffectiveReviews(sectionId, { includeArchived = false } = {}) {
  const filter = { $or: [{ section: null }, ...(sectionId ? [{ section: sectionId }] : [])] };
  if (!includeArchived) filter.archivedAt = null;
  const all = await ReviewConfig.find(filter).lean();
  const byKey = new Map();
  for (const cfg of all.sort((a, b) => (a.section ? 1 : 0) - (b.section ? 1 : 0))) byKey.set(cfg.key, cfg);
  return [...byKey.values()].sort((a, b) => a.order - b.order);
}

export async function getEffectiveReview(sectionId, key) {
  return (await getEffectiveReviews(sectionId)).find((r) => r.key === key) || null;
}

export async function configHasHistory(cfg) {
  const scope = cfg.section ? { section: cfg.section } : {};
  const q = { reviewKey: cfg.key, ...scope };
  return Boolean((await Submission.exists(q)) || (await Contribution.exists(q)));
}

const KEY = /^[a-z][a-z0-9-]{1,40}$/;

/** Validates a create/update payload and returns the sanitised document fragment. */
export function parseConfigInput(body, { creating, existing, hasHistory }) {
  const v = new Validator(body);
  const out = {};
  const name = v.string("name", { required: creating, max: 160 });
  if (name !== undefined) out.name = name;
  const order = v.int("order", { required: creating, min: 1, max: 50 });
  if (order !== undefined) out.order = order;
  if (creating) {
    const key = v.string("key", { required: true });
    if (key && !KEY.test(key)) v.fail("key", "Use lowercase letters, numbers and hyphens (e.g. review-5)");
    out.key = key;
    out.type = v.oneOf("type", REVIEW_TYPES, { required: true });
  } else if (body?.type !== undefined && body.type !== existing.type) {
    v.fail("type", "A review's type cannot be changed after it is created");
  }
  if (body?.deadline !== undefined) {
    if (body.deadline === null || body.deadline === "") out.deadline = null;
    else if (Number.isNaN(Date.parse(body.deadline))) v.fail("deadline", "Enter a valid date and time");
    else out.deadline = new Date(body.deadline);
  }
  const type = out.type || existing?.type;

  const fields = v.array("fields", { max: 30 });
  if (fields) {
    const seen = new Set();
    out.fields = fields.map((f, i) => {
      const fv = new Validator(f);
      const key = fv.string(`key`, { required: true, max: 40 });
      const label = fv.string("label", { required: true, max: 120 });
      const kind = fv.oneOf("kind", ["text", "longtext", "select"]) || "text";
      const maxLength = fv.int("maxLength", { min: 1, max: 10000 }) ?? 4000;
      let options = [];
      if (kind === "select") {
        options = (fv.array("options", { required: true, max: 20 }) || []).map((o) => ({ value: String(o?.value ?? "").slice(0, 60), label: String(o?.label ?? o?.value ?? "").slice(0, 80) }));
        if (!options.length || options.some((o) => !o.value)) fv.fail("options", "Add at least one option with a value");
      }
      if (key && (!/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(key) || seen.has(key))) fv.fail("key", "Field keys must be unique and use letters, numbers or underscores");
      seen.add(key);
      if (Object.keys(fv.errors).length) v.fail("fields", `Field ${i + 1}: ${Object.values(fv.errors)[0]}`);
      return { key, label, kind, required: Boolean(f.required), maxLength, options, deprecated: Boolean(f.deprecated) };
    });
    if (type === "title" && !out.fields.some((f) => f.key === "projectTitle" && !f.deprecated)) v.fail("fields", "A title review needs a 'projectTitle' field");
  }

  const milestones = v.array("milestones", { max: 30 });
  if (milestones) {
    if (type !== "progress") v.fail("milestones", "Only progress reviews have milestones");
    const seen = new Set();
    out.milestones = milestones.map((m) => {
      const key = String(m?.key ?? "").trim();
      const label = String(m?.label ?? "").trim().slice(0, 80);
      if (!/^[a-z][a-z0-9_-]{0,40}$/.test(key) || !label || seen.has(key)) v.fail("milestones", "Each milestone needs a unique lowercase key and a label");
      seen.add(key);
      return { key, label, deprecated: Boolean(m?.deprecated) };
    });
    if (!out.milestones.some((m) => !m.deprecated)) v.fail("milestones", "A progress review needs at least one active milestone");
  }

  const ic = v.bool("individualContributions");
  if (ic !== undefined) out.individualContributions = ic;

  if (body?.upload !== undefined) {
    const u = new Validator(body.upload);
    const enabled = u.bool("enabled");
    const required = u.bool("required");
    const types = u.array("acceptedTypes", { max: 10 });
    const maxSizeMB = u.int("maxSizeMB", { min: 1, max: 25 });
    u.done();
    const up = { enabled: enabled ?? existing?.upload?.enabled ?? false, required: required ?? existing?.upload?.required ?? false, acceptedTypes: existing?.upload?.acceptedTypes ?? ["pdf"], maxSizeMB: maxSizeMB ?? existing?.upload?.maxSizeMB ?? 10 };
    if (types) {
      const clean = types.map((t) => String(t).toLowerCase());
      if (!clean.length || clean.some((t) => !FILE_SIGNATURES[t])) v.fail("upload", `Allowed file types: ${Object.keys(FILE_SIGNATURES).join(", ")}`);
      up.acceptedTypes = clean;
    }
    if (up.required && !up.enabled) up.enabled = true;
    out.upload = up;
  }
  v.done();

  if (hasHistory && existing) {
    const lost = (oldList, newList) => oldList.filter((o) => !newList.some((n) => n.key === o.key)).map((o) => o.key);
    if (out.fields) {
      const gone = lost(existing.fields, out.fields);
      if (gone.length) throw conflict(`This review already has submissions. Mark these fields as deprecated instead of removing them: ${gone.join(", ")}`);
      for (const f of existing.fields) {
        const nf = out.fields.find((x) => x.key === f.key);
        if (nf.kind !== f.kind) throw conflict(`Field "${f.key}" cannot change type because submissions exist`);
        if (f.kind === "select" && f.options.some((o) => !nf.options.some((n) => n.value === o.value))) throw conflict(`Options of "${f.key}" cannot be removed because submissions exist`);
      }
    }
    if (out.milestones) {
      const gone = lost(existing.milestones, out.milestones);
      if (gone.length) throw conflict(`This review already has progress records. Mark these milestones as deprecated instead of removing them: ${gone.join(", ")}`);
    }
  }
  return out;
}

export { PROGRESS_STATUS, badRequest };
