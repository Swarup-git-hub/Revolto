import { Router } from "express";
import Settings from "../../models/Settings.js";
import { asyncHandler } from "../../shared/errors.js";
import { authorize, protect } from "../../shared/auth.js";
import { getSettings } from "../../shared/settings.js";
import { Validator } from "../../shared/validate.js";
import { FILE_SIGNATURES } from "../../shared/constants.js";
import { audit } from "../../shared/audit.js";

const router = Router();
router.use(protect);

router.get("/", asyncHandler(async (_req, res) => {
  const s = await getSettings();
  const { _id, __v, createdAt, updatedAt, key, ...rest } = s;
  res.json({ settings: rest });
}));

/** HOD only. Every field is validated individually; unknown fields are ignored. */
router.patch("/", authorize("hod"), asyncHandler(async (req, res) => {
  const before = await getSettings();
  const set = {};
  const b = req.body || {};

  const t = new Validator(b.team);
  const minSize = t.int("minSize", { min: 1, max: 20 });
  const maxSize = t.int("maxSize", { min: 1, max: 20 });
  t.done();
  if (minSize !== undefined) set["team.minSize"] = minSize;
  if (maxSize !== undefined) set["team.maxSize"] = maxSize;
  if ((maxSize ?? before.team.maxSize) < (minSize ?? before.team.minSize)) return res.status(400).json({ error: "Maximum team size cannot be below the minimum" });

  const sec = new Validator(b.section);
  if (sec.has("defaultCapacity")) set["section.defaultCapacity"] = b.section.defaultCapacity === null ? null : sec.int("defaultCapacity", { min: 1, max: 5000 });
  sec.done();

  const g = new Validator(b.guide);
  const maxTeams = g.int("maxTeams", { min: 1, max: 100 });
  g.done();
  if (maxTeams !== undefined) set["guide.maxTeams"] = maxTeams;

  const r = new Validator(b.reviews);
  const reconf = r.bool("requireTitleReconfirmation");
  r.done();
  if (reconf !== undefined) set["reviews.requireTitleReconfirmation"] = reconf;

  const u = new Validator(b.uploads);
  const types = u.array("defaultAcceptedTypes", { max: 10 });
  const size = u.int("defaultMaxSizeMB", { min: 1, max: 25 });
  u.done();
  if (types) {
    const clean = types.map((x) => String(x).toLowerCase());
    if (clean.some((x) => !FILE_SIGNATURES[x])) return res.status(400).json({ error: `Unsupported file type. Supported: ${Object.keys(FILE_SIGNATURES).join(", ")}` });
    set["uploads.defaultAcceptedTypes"] = clean;
  }
  if (size !== undefined) set["uploads.defaultMaxSizeMB"] = size;

  const c = new Validator(b.college);
  const cname = c.string("name", { max: 160 });
  const tz = c.int("timezoneOffsetMinutes", { min: -720, max: 840 });
  c.done();
  if (cname !== undefined) set["college.name"] = cname;
  if (tz !== undefined) set["college.timezoneOffsetMinutes"] = tz;

  await Settings.updateOne({ key: "default" }, { $set: set });
  const after = await getSettings();
  await audit(req.user, { action: "UPDATE", entity: "Settings", entityName: "College settings", before: { team: before.team, section: before.section, guide: before.guide, reviews: before.reviews, uploads: before.uploads, college: before.college }, after: { team: after.team, section: after.section, guide: after.guide, reviews: after.reviews, uploads: after.uploads, college: after.college }, ip: req.ip });
  const { _id, __v, createdAt, updatedAt, key, ...rest } = after;
  res.json({ settings: rest });
}));

export default router;
