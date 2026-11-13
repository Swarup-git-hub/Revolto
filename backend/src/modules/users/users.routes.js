import { Router } from "express";
import Section from "../../models/Section.js";
import Team from "../../models/Team.js";
import User from "../../models/User.js";
import { ROLE_LIST } from "../../shared/constants.js";
import { asyncHandler, badRequest, conflict, forbidden, notFound } from "../../shared/errors.js";
import { authorize, protect } from "../../shared/auth.js";
import { Validator, escapeRegex, pageParams, parseId } from "../../shared/validate.js";
import { audit } from "../../shared/audit.js";
import { inCoordinatorScope } from "../../shared/scope.js";
import { createStudentWithSeat, releaseSeat, reserveSeat } from "../sections/capacity.js";

const router = Router();
router.use(protect);

const PUBLIC = "name email role rollNumber phone section sections team isActive archivedAt createdAt";
const shape = (u) => ({
  id: String(u._id),
  name: u.name,
  email: u.email,
  role: u.role,
  rollNumber: u.rollNumber || null,
  phone: u.phone || null,
  section: u.section && u.section._id ? { id: String(u.section._id), name: u.section.name } : u.section ? { id: String(u.section) } : null,
  sections: (u.sections || []).map((s) => (s._id ? { id: String(s._id), name: s.name } : { id: String(s) })),
  team: u.team && u.team._id ? { id: String(u.team._id), teamId: u.team.teamId } : u.team ? { id: String(u.team) } : null,
  isActive: u.isActive,
  archivedAt: u.archivedAt,
});

/** Which user records the requester may see/manage. */
function visibility(user) {
  if (user.role === "hod") return {};
  if (user.role === "coordinator") return { $or: [{ role: "student", section: { $in: user.sections } }, { role: "guide" }] };
  if (user.role === "guide") return { _id: null }; // guides read team members through their teams, not the user directory
  return { _id: null };
}

router.get("/", authorize("hod", "coordinator"), asyncHandler(async (req, res) => {
  const { page, limit, skip } = pageParams(req.query);
  const q = req.query;
  const and = [visibility(req.user)];
  if (q.role && ROLE_LIST.includes(q.role)) and.push({ role: q.role });
  if (q.section) and.push({ section: parseId(q.section, "section") });
  if (q.status === "archived") and.push({ isActive: false });
  else if (q.status !== "all") and.push({ isActive: true });
  if (q.unassigned === "true") and.push({ role: "student", team: null });
  if (q.search) {
    const rx = new RegExp(escapeRegex(String(q.search).slice(0, 60)), "i");
    and.push({ $or: [{ name: rx }, { email: rx }, { rollNumber: rx }] });
  }
  const filter = { $and: and };
  const [users, total] = await Promise.all([
    User.find(filter, PUBLIC).populate("section", "name").populate("sections", "name").populate("team", "teamId").sort({ role: 1, name: 1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);
  res.json({ users: users.map(shape), total, page, limit });
}));

/** Students without a team that a guide/coordinator/HOD may add to a team in the given section. */
router.get("/available-students", authorize("hod", "coordinator", "guide"), asyncHandler(async (req, res) => {
  const sectionId = parseId(req.query.section, "section");
  if (req.user.role === "coordinator" && !req.user.sections.includes(sectionId)) throw forbidden();
  if (req.user.role === "guide" && !(await Team.exists({ guide: req.user._id, section: sectionId, status: "active" }))) throw forbidden();
  const filter = { role: "student", isActive: true, team: null, section: sectionId };
  if (req.query.search) {
    const rx = new RegExp(escapeRegex(String(req.query.search).slice(0, 60)), "i");
    filter.$or = [{ name: rx }, { rollNumber: rx }];
  }
  const users = await User.find(filter, "name email rollNumber").sort({ rollNumber: 1 }).limit(100).lean();
  res.json({ users: users.map((u) => ({ id: String(u._id), name: u.name, email: u.email, rollNumber: u.rollNumber })) });
}));

/** Guides list for team assignment, with current workload. */
router.get("/guides", authorize("hod", "coordinator"), asyncHandler(async (_req, res) => {
  const guides = await User.find({ role: "guide", isActive: true }, "name email").sort({ name: 1 }).lean();
  const counts = await Team.aggregate([{ $match: { status: "active" } }, { $group: { _id: "$guide", n: { $sum: 1 } } }]);
  const map = new Map(counts.map((c) => [String(c._id), c.n]));
  res.json({ guides: guides.map((g) => ({ id: String(g._id), name: g.name, email: g.email, teamCount: map.get(String(g._id)) || 0 })) });
}));

router.post("/", authorize("hod", "coordinator"), asyncHandler(async (req, res) => {
  const v = new Validator(req.body);
  const name = v.string("name", { required: true, max: 120 });
  const email = v.email("email", { required: true });
  const role = v.oneOf("role", ROLE_LIST, { required: true });
  const phone = v.string("phone", { max: 20 });
  const rollNumber = v.string("rollNumber", { max: 40 });
  const sectionId = v.id("section");
  const sectionIds = (v.array("sections", { max: 20 }) || []).map((s) => parseId(s, "section"));
  v.done();

  if (req.user.role === "coordinator") {
    if (role !== "student") throw forbidden("Coordinators can only create student accounts");
    if (!sectionId || !req.user.sections.includes(sectionId)) throw forbidden("You can only add students to your assigned sections");
  }
  if (role === "student") {
    if (!sectionId) throw badRequest("A section is required for students", { section: "Section is required" });
    if (!rollNumber) throw badRequest("A roll number is required for students", { rollNumber: "Roll number is required" });
  }
  if (await User.exists({ email })) throw conflict("A user with this email already exists", { email: "Already in use" });
  if (rollNumber && (await User.exists({ rollNumber: rollNumber.toUpperCase() }))) throw conflict("A user with this roll number already exists", { rollNumber: "Already in use" });
  if (role === "coordinator" && sectionIds.length) {
    if ((await Section.countDocuments({ _id: { $in: sectionIds } })) !== new Set(sectionIds).size) throw badRequest("One or more sections do not exist");
  }

  const fields = {
    name, email, role, phone, createdBy: req.user._id,
    ...(role === "student" ? { rollNumber, section: sectionId } : {}),
    ...(role === "coordinator" ? { sections: sectionIds } : {}),
  };
  // students always take a seat atomically (released automatically if creation fails)
  const doc = role === "student" ? await createStudentWithSeat(fields) : await User.create(fields);
  await audit(req.user, { action: "CREATE", entity: "User", entityId: doc._id, entityName: `${role} ${name}`, after: { name, email, role, section: sectionId, sections: sectionIds }, ip: req.ip });
  res.status(201).json({ user: shape(doc) });
}));

async function loadManageable(req) {
  const target = await User.findOne({ $and: [{ _id: parseId(req.params.id, "user id") }, visibility(req.user)] });
  if (!target) throw notFound("User not found");
  return target;
}

router.patch("/:id", authorize("hod", "coordinator"), asyncHandler(async (req, res) => {
  const target = await loadManageable(req);
  const isHod = req.user.role === "hod";
  if (!isHod && target.role !== "student") throw forbidden("Coordinators can only edit student accounts");
  if (!isHod && !inCoordinatorScope(req.user, target.section)) throw forbidden();

  const v = new Validator(req.body);
  const name = v.string("name", { max: 120 });
  const phone = v.string("phone", { max: 20 });
  const rollNumber = v.string("rollNumber", { max: 40 });
  const sectionId = v.id("section");
  const email = isHod ? v.email("email") : undefined;
  const role = isHod ? v.oneOf("role", ROLE_LIST) : undefined;
  const sectionIds = isHod ? (v.array("sections", { max: 20 }) || undefined)?.map((s) => parseId(s, "section")) : undefined;
  v.done();

  const before = { name: target.name, email: target.email, role: target.role, rollNumber: target.rollNumber, section: target.section, sections: target.sections };
  const seatOf = (u) => (u.role === "student" && u.isActive && u.section ? String(u.section) : null);
  const seatBefore = seatOf(target);
  if (name !== undefined) target.name = name;
  if (phone !== undefined) target.phone = phone;
  if (email !== undefined && email !== target.email) {
    if (await User.exists({ email, _id: { $ne: target._id } })) throw conflict("Email already in use", { email: "Already in use" });
    target.email = email;
  }
  if (rollNumber !== undefined && rollNumber.toUpperCase() !== target.rollNumber) {
    if (await User.exists({ rollNumber: rollNumber.toUpperCase(), _id: { $ne: target._id } })) throw conflict("Roll number already in use", { rollNumber: "Already in use" });
    target.rollNumber = rollNumber;
  }
  if (role !== undefined && role !== target.role) {
    if (String(target._id) === req.user.id) throw forbidden("You cannot change your own role");
    if (target.team) throw conflict("Remove the student from their team before changing role");
    if (target.role === "guide" && (await Team.exists({ guide: target._id, status: "active" }))) throw conflict("Reassign this guide's teams before changing role");
    target.role = role;
    if (role !== "student") { target.section = null; target.rollNumber = undefined; }
    if (role !== "coordinator") target.sections = [];
    target.tokenVersion += 1;
  }
  if (sectionId !== undefined && String(target.section) !== sectionId) {
    if (target.role !== "student") throw badRequest("Only students belong to a single section");
    if (!isHod && !req.user.sections.includes(sectionId)) throw forbidden("You can only move students within your assigned sections");
    if (target.team) throw conflict("Remove the student from their team before changing section");
    target.section = sectionId;
  }
  if (sectionIds !== undefined && target.role === "coordinator") target.sections = sectionIds;

  // Seats follow the student: take one in the new section first (409 if full), save, then give the old one back.
  const seatAfter = seatOf(target);
  const moved = seatAfter !== seatBefore;
  if (moved && seatAfter) await reserveSeat(seatAfter);
  try {
    await target.save();
  } catch (err) {
    if (moved && seatAfter) await releaseSeat(seatAfter);
    throw err;
  }
  if (moved && seatBefore) await releaseSeat(seatBefore);
  await audit(req.user, { action: "UPDATE", entity: "User", entityId: target._id, entityName: `${target.role} ${target.name}`, before, after: { name: target.name, email: target.email, role: target.role, rollNumber: target.rollNumber, section: target.section, sections: target.sections }, ip: req.ip });
  res.json({ user: shape(target) });
}));

/** Accounts are archived, never hard-deleted, so submissions and audit history stay attributable. */
router.post("/:id/archive", authorize("hod", "coordinator"), asyncHandler(async (req, res) => {
  const target = await loadManageable(req);
  if (String(target._id) === req.user.id) throw forbidden("You cannot archive your own account");
  if (req.user.role === "coordinator" && (target.role !== "student" || !inCoordinatorScope(req.user, target.section))) throw forbidden();
  if (target.role === "guide" && (await Team.exists({ guide: target._id, status: "active" }))) throw conflict("Reassign this guide's active teams before archiving the account");
  if (target.role === "student" && target.team && (await Team.exists({ _id: target.team, leader: target._id, status: "active" }))) throw conflict("This student is the team leader. Appoint another leader (or remove them from the team with a replacement) before archiving the account.");
  if (target.role === "hod" && (await User.countDocuments({ role: "hod", isActive: true })) <= 1) throw conflict("The last active HOD account cannot be archived");
  const v = new Validator(req.body);
  const reason = v.string("reason", { max: 300 });
  v.done();
  const hadSeat = target.role === "student" && target.isActive && target.section ? String(target.section) : null;
  target.isActive = false;
  target.archivedAt = new Date();
  target.tokenVersion += 1;
  await target.save();
  if (hadSeat) await releaseSeat(hadSeat);
  await audit(req.user, { action: "ARCHIVE", entity: "User", entityId: target._id, entityName: `${target.role} ${target.name}`, reason, ip: req.ip });
  res.json({ user: shape(target) });
}));

router.post("/:id/restore", authorize("hod", "coordinator"), asyncHandler(async (req, res) => {
  const target = await loadManageable(req);
  if (req.user.role === "coordinator" && (target.role !== "student" || !inCoordinatorScope(req.user, target.section))) throw forbidden();
  if (target.isActive) return res.json({ user: shape(target) }); // already active: nothing to do (and no extra seat)
  const needsSeat = target.role === "student" && target.section;
  if (needsSeat) await reserveSeat(target.section);
  try {
    target.isActive = true;
    target.archivedAt = null;
    await target.save();
  } catch (err) {
    if (needsSeat) await releaseSeat(target.section);
    throw err;
  }
  await audit(req.user, { action: "RESTORE", entity: "User", entityId: target._id, entityName: `${target.role} ${target.name}`, ip: req.ip });
  res.json({ user: shape(target) });
}));

export default router;
