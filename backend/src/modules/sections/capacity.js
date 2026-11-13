import Section from "../../models/Section.js";
import User from "../../models/User.js";
import { conflict, notFound } from "../../shared/errors.js";
import { getSettings } from "../../shared/settings.js";

export async function sectionCapacity(section) {
  if (section.capacity) return section.capacity;
  return (await getSettings()).section.defaultCapacity || null;
}

const countActiveStudents = (sectionId) => User.countDocuments({ role: "student", section: sectionId, isActive: true });

/** Sections created before counters existed have no `studentCount`; initialise it once from real data. */
async function ensureCounter(section) {
  if (typeof section.studentCount === "number") return;
  await Section.updateOne({ _id: section._id, studentCount: { $exists: false } }, { $set: { studentCount: await countActiveStudents(section._id) } });
}

/**
 * Atomically takes one seat in a section (single `findOneAndUpdate`, guarded by `studentCount < capacity`), so two
 * concurrent requests can never both take the last seat. The caller MUST call releaseSeat() if the student record is
 * not created/kept afterwards. Throws 409 when the section is full and 404 when it is missing/archived.
 */
export async function reserveSeat(sectionId) {
  const section = await Section.findById(sectionId).lean();
  if (!section || !section.isActive) throw notFound("Section not found or archived");
  await ensureCounter(section);
  const cap = await sectionCapacity(section);
  const reserved = await Section.findOneAndUpdate(
    { _id: section._id, isActive: true, studentCount: cap ? { $lt: cap } : { $type: "number" } },
    { $inc: { studentCount: 1 } },
    { new: true }
  );
  if (!reserved) {
    const fresh = await Section.findById(section._id, "studentCount isActive").lean();
    if (!fresh?.isActive) throw notFound("Section not found or archived");
    throw conflict(`Section ${section.name} is at capacity (${fresh.studentCount}/${cap} students)`, { section: "Section is at capacity" });
  }
  return reserved.toObject();
}

export async function releaseSeat(sectionId) {
  if (!sectionId) return;
  await Section.updateOne({ _id: sectionId, studentCount: { $gt: 0 } }, { $inc: { studentCount: -1 } });
}

/** The ONLY way new student accounts are created: reserve a seat, create, and give the seat back if creation fails. */
export async function createStudentWithSeat(fields) {
  await reserveSeat(fields.section);
  try {
    return await User.create(fields);
  } catch (err) {
    await releaseSeat(fields.section);
    throw err;
  }
}
