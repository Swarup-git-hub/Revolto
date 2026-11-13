import { PROGRESS_STATUS } from "../../shared/constants.js";
import { badRequest } from "../../shared/errors.js";

/** Validates free-form `data` against a review's configured fields; unknown keys are discarded. */
export function validateFields(config, data) {
  const src = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const errors = {};
  const out = {};
  for (const f of config.fields.filter((x) => !x.deprecated)) {
    let val = src[f.key];
    if (val === undefined || val === null || (typeof val === "string" && !val.trim())) {
      if (f.required) errors[f.key] = `${f.label} is required`;
      continue;
    }
    if (typeof val !== "string") {
      errors[f.key] = `${f.label} must be text`;
      continue;
    }
    val = val.trim();
    if (val.length > f.maxLength) errors[f.key] = `${f.label} must be at most ${f.maxLength} characters`;
    else if (f.kind === "select" && !f.options.some((o) => o.value === val)) errors[f.key] = `Choose a valid option for ${f.label}`;
    else out[f.key] = val;
  }
  if (Object.keys(errors).length) throw badRequest("Please correct the highlighted fields", errors);
  return out;
}

const percentRule = (status, percent) => {
  if (percent === undefined) return null;
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) return "Percentage must be between 0 and 100";
  if (status === "completed" && percent !== 100) return "A completed item must be 100%";
  if (status === "not_started" && percent !== 0) return "A not-started item must be 0%";
  return null;
};

/** Team-level milestone checklist: every active milestone must be reported explicitly (nothing is assumed). */
export function validateMilestones(config, milestones) {
  const active = (config.milestones || []).filter((m) => !m.deprecated);
  if (!Array.isArray(milestones)) throw badRequest("Milestone checklist is required", { milestones: "Milestone checklist is required" });
  const errors = {};
  const out = [];
  for (const m of active) {
    const item = milestones.find((x) => x?.key === m.key);
    if (!item) {
      errors[m.key] = `Report a status for "${m.label}"`;
      continue;
    }
    if (!PROGRESS_STATUS.includes(item.status)) {
      errors[m.key] = `Choose a valid status for "${m.label}"`;
      continue;
    }
    const percent = item.percent === undefined || item.percent === null || item.percent === "" ? undefined : Number(item.percent);
    const perr = percentRule(item.status, percent);
    if (perr) {
      errors[m.key] = `${m.label}: ${perr}`;
      continue;
    }
    const notes = typeof item.notes === "string" ? item.notes.trim().slice(0, 500) : "";
    out.push({ key: m.key, status: item.status, ...(percent !== undefined ? { percent } : {}), ...(notes ? { notes } : {}) });
  }
  if (Object.keys(errors).length) throw badRequest("Please correct the milestone checklist", errors);
  return out;
}

/** Individual contribution: summary plus tasks tied to configured milestones. */
export function validateContribution(config, data) {
  const src = data && typeof data === "object" ? data : {};
  const errors = {};
  const summary = typeof src.summary === "string" ? src.summary.trim() : "";
  if (!summary) errors.summary = "Describe what you worked on";
  else if (summary.length > 3000) errors.summary = "Summary must be at most 3000 characters";
  const notes = typeof src.notes === "string" ? src.notes.trim().slice(0, 2000) : "";
  const keys = new Set((config.milestones || []).filter((m) => !m.deprecated).map((m) => m.key));
  const tasksIn = Array.isArray(src.tasks) ? src.tasks.slice(0, 20) : [];
  const tasks = [];
  tasksIn.forEach((t, i) => {
    const description = typeof t?.description === "string" ? t.description.trim() : "";
    const percent = t?.percent === undefined || t?.percent === null || t?.percent === "" ? undefined : Number(t.percent);
    if (!keys.has(t?.milestoneKey)) errors[`tasks.${i}`] = "Choose a milestone";
    else if (!description || description.length > 500) errors[`tasks.${i}`] = "Describe the task (up to 500 characters)";
    else if (!PROGRESS_STATUS.includes(t.status)) errors[`tasks.${i}`] = "Choose a status";
    else if (percentRule(t.status, percent)) errors[`tasks.${i}`] = percentRule(t.status, percent);
    else tasks.push({ milestoneKey: t.milestoneKey, description, status: t.status, ...(percent !== undefined ? { percent } : {}) });
  });
  if (Object.keys(errors).length) throw badRequest("Please correct the highlighted fields", errors);
  return { summary, tasks, notes };
}
