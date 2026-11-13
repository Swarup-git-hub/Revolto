import { Router } from "express";
import Section from "../../models/Section.js";
import Team from "../../models/Team.js";
import User from "../../models/User.js";
import { asyncHandler, conflict, notFound } from "../../shared/errors.js";
import { authorize, protect } from "../../shared/auth.js";
import { Validator, parseId } from "../../shared/validate.js";
import { audit } from "../../shared/audit.js";
import { sectionCapacity } from "./capacity.js";
import { reconcileCounters } from "../../shared/counters.js";

const router = Router();
router.use(protect);

async function visibleSectionFilter(user) {
  if (user.role === "hod") return {};
  if (user.role === "coordinator") return { _id: { $in: user.sections } };
  if (user.role === "guide") return { _id: { $in: await Team.distinct("section", { guide: user._id }) } };
  return { _id: user.section };
}

router.get("/", asyncHandler(async (req, res) => {
  const filter = await visibleSectionFilter(req.user);
  if (req.query.includeArchived !== "true") filter.isActive = true;
  const sections = await Section.find(filter).sort({ name: 1 }).lean();
  const manager = ["hod", "coordinator"].includes(req.user.role);
  const out = [];
  for (const s of sections) {
    const row = { id: String(s._id), name: s.name, capacity: s.capacity, isActive: s.isActive, booking: s.booking };
    if (manager) {
      row.studentCount = await User.countDocuments({ role: "student", section: s._id, isActive: true });
      row.teamCount = await Team.countDocuments({ section: s._id, status: "active" });
      row.effectiveCapacity = await sectionCapacity(s);
      row.coordinators = (await User.find({ role: "coordinator", sections: s._id, isActive: true }, "name email").lean()).map((c) => ({ id: String(c._id), name: c.name, email: c.email }));
    }
    out.push(row);
  }
  res.json({ sections: out });
}));

/** Recomputes seat/workload counters from real data and reports corrections. Best run when no bulk changes are in progress. */
router.post("/reconcile", authorize("hod"), asyncHandler(async (req, res) => {
  const result = await reconcileCounters();
  await audit(req.user, { action: "UPDATE", entity: "Section", entityName: "Counter reconciliation", after: { sectionsCorrected: result.sections.length, guidesCorrected: result.guides.length }, ip: req.ip });
  res.json(result);
}));

router.post("/", authorize("hod"), asyncHandler(async (req, res) => {
  const v = new Validator(req.body);
  const name = v.string("name", { required: true, max: 40 });
  const capacity = v.int("capacity", { min: 1, max: 5000 });
  v.done();
  if (await Section.exists({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") })) throw conflict("A section with that name already exists");
  const section = await Section.create({ name, capacity: capacity ?? null });
  await audit(req.user, { action: "CREATE", entity: "Section", entityId: section._id, entityName: name, after: { name, capacity }, ip: req.ip });
  res.status(201).json({ section });
}));

router.patch("/:id", authorize("hod"), asyncHandler(async (req, res) => {
  const section = await Section.findById(parseId(req.params.id));
  if (!section) throw notFound("Section not found");
  const v = new Validator(req.body);
  const name = v.string("name", { max: 40 });
  const capacity = req.body?.capacity === null ? null : v.int("capacity", { min: 1, max: 5000 });
  const isActive = v.bool("isActive");
  v.done();
  const before = { name: section.name, capacity: section.capacity, isActive: section.isActive };
  if (name !== undefined) section.name = name;
  if (capacity !== undefined) section.capacity = capacity;
  if (isActive !== undefined) {
    section.isActive = isActive;
    section.archivedAt = isActive ? null : new Date();
  }
  await section.save();
  await audit(req.user, { action: "UPDATE", entity: "Section", entityId: section._id, entityName: section.name, before, after: { name: section.name, capacity: section.capacity, isActive: section.isActive }, ip: req.ip });
  res.json({ section });
}));

/** Replace the set of coordinators assigned to a section. */
router.put("/:id/coordinators", authorize("hod"), asyncHandler(async (req, res) => {
  const section = await Section.findById(parseId(req.params.id));
  if (!section) throw notFound("Section not found");
  const v = new Validator(req.body);
  const ids = (v.array("coordinatorIds", { required: true, max: 20 }) || []).map((i) => parseId(i, "coordinator id"));
  v.done();
  const coordinators = await User.find({ _id: { $in: ids }, role: "coordinator", isActive: true }, "_id").lean();
  if (coordinators.length !== new Set(ids).size) throw conflict("Every selected user must be an active coordinator");
  const before = (await User.find({ role: "coordinator", sections: section._id }, "email").lean()).map((u) => u.email);
  await User.updateMany({ role: "coordinator", sections: section._id }, { $pull: { sections: section._id } });
  await User.updateMany({ _id: { $in: ids } }, { $addToSet: { sections: section._id } });
  const after = (await User.find({ role: "coordinator", sections: section._id }, "email").lean()).map((u) => u.email);
  await audit(req.user, { action: "UPDATE", entity: "Section", entityId: section._id, entityName: section.name, before: { coordinators: before }, after: { coordinators: after }, reason: "Coordinator assignment", ip: req.ip });
  res.json({ message: "Coordinators updated" });
}));

export default router;
