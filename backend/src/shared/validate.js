import mongoose from "mongoose";
import { badRequest } from "./errors.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const isObjectId = (v) => typeof v === "string" && /^[a-f\d]{24}$/i.test(v);
export const toObjectId = (v) => new mongoose.Types.ObjectId(v);

/**
 * Collects field errors and throws a single 400 with details. Only the fields a handler
 * explicitly reads are ever returned, which also prevents mass assignment.
 */
/** "projectTitle" -> "Project title" so API messages read naturally in the UI. */
const human = (f) => { const t = String(f).replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); };

export class Validator {
  constructor(source) {
    this.src = source && typeof source === "object" && !Array.isArray(source) ? source : {};
    this.errors = {};
  }
  fail(field, msg) {
    this.errors[field] ??= msg;
    return undefined;
  }
  has(field) {
    return this.src[field] !== undefined;
  }
  string(field, { required = false, min = 0, max = 2000, trim = true, label } = {}) {
    let v = this.src[field];
    if (v === undefined || v === null || v === "") {
      if (required) this.fail(field, `${label || human(field)} is required`);
      return undefined;
    }
    if (typeof v !== "string") return this.fail(field, `${label || human(field)} must be text`);
    if (trim) v = v.trim();
    if (required && !v) return this.fail(field, `${label || human(field)} is required`);
    if (v.length < min) return this.fail(field, `${label || human(field)} must be at least ${min} characters`);
    if (v.length > max) return this.fail(field, `${label || human(field)} must be at most ${max} characters`);
    return v;
  }
  email(field, { required = false } = {}) {
    const v = this.string(field, { required, max: 254 });
    if (v === undefined) return undefined;
    if (!EMAIL.test(v)) return this.fail(field, "Enter a valid email address");
    return v.toLowerCase();
  }
  oneOf(field, options, { required = false } = {}) {
    const v = this.src[field];
    if (v === undefined || v === null || v === "") {
      if (required) this.fail(field, `${human(field)} is required`);
      return undefined;
    }
    if (!options.includes(v)) return this.fail(field, `${human(field)} must be one of: ${options.join(", ")}`);
    return v;
  }
  int(field, { required = false, min = -Infinity, max = Infinity } = {}) {
    const v = this.src[field];
    if (v === undefined || v === null || v === "") {
      if (required) this.fail(field, `${human(field)} is required`);
      return undefined;
    }
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isInteger(n)) return this.fail(field, `${human(field)} must be a whole number`);
    if (n < min || n > max) return this.fail(field, `${human(field)} must be between ${min} and ${max}`);
    return n;
  }
  bool(field) {
    const v = this.src[field];
    if (v === undefined) return undefined;
    if (typeof v !== "boolean") return this.fail(field, `${human(field)} must be true or false`);
    return v;
  }
  id(field, { required = false } = {}) {
    const v = this.src[field];
    if (v === undefined || v === null || v === "") {
      if (required) this.fail(field, `${human(field)} is required`);
      return undefined;
    }
    if (!isObjectId(String(v))) return this.fail(field, `${human(field)} is not a valid id`);
    return String(v);
  }
  date(field, { required = false } = {}) {
    const v = this.string(field, { required });
    if (v === undefined) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) return this.fail(field, `${human(field)} must be a date (YYYY-MM-DD)`);
    return v;
  }
  array(field, { required = false, max = 200 } = {}) {
    const v = this.src[field];
    if (v === undefined || v === null) {
      if (required) this.fail(field, `${human(field)} is required`);
      return undefined;
    }
    if (!Array.isArray(v)) return this.fail(field, `${human(field)} must be a list`);
    if (v.length > max) return this.fail(field, `${human(field)} has too many items (max ${max})`);
    return v;
  }
  done() {
    if (Object.keys(this.errors).length) throw badRequest("Please correct the highlighted fields", this.errors);
  }
}

export function parseId(value, label = "id") {
  if (!isObjectId(String(value))) throw badRequest(`Invalid ${label}`);
  return String(value);
}

export function pageParams(query, { defaultLimit = 50, maxLimit = 200 } = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number.parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}
