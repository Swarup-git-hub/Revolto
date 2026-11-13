import ExcelJS from "exceljs";
import Section from "../../models/Section.js";
import Team from "../../models/Team.js";
import User from "../../models/User.js";
import { badRequest } from "../../shared/errors.js";
import { getSettings } from "../../shared/settings.js";
import { addMember, generateTeamId, releaseGuideSlot, reserveGuideSlot } from "../teams/teams.service.js";
import { createStudentWithSeat, sectionCapacity } from "../sections/capacity.js";

export const MAX_ROWS = 2000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const norm = (h) => String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

export const TYPES = {
  students: { columns: ["rollNumber", "name", "email", "section", "phone"], example: ["21CS001", "Asha Rao", "asha@college.edu", "A", ""], roles: ["hod", "coordinator"] },
  teams: { columns: ["teamId", "section", "guideEmail", "projectTitle", "leaderRoll", "memberRolls"], example: ["", "A", "guide@college.edu", "Smart Attendance", "21CS001", "21CS001;21CS002;21CS003"], roles: ["hod", "coordinator"] },
  staff: { columns: ["name", "email", "role", "sections"], example: ["Dr. Rao", "rao@college.edu", "guide", ""], roles: ["hod"] },
};

export async function buildTemplate(type, format) {
  const def = TYPES[type];
  if (format === "csv") return { buffer: Buffer.from(`${def.columns.join(",")}\n${def.example.map((c) => `"${c}"`).join(",")}\n`), contentType: "text/csv; charset=utf-8", ext: "csv" };
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(type);
  ws.addRow(def.columns).font = { bold: true };
  ws.addRow(def.example);
  ws.columns.forEach((c) => (c.width = 24));
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx" };
}

/** Parses a CSV/XLSX buffer into rows keyed by the template's column names. Unknown columns are ignored. */
export async function parseFile(type, file) {
  const def = TYPES[type];
  const wb = new ExcelJS.Workbook();
  const name = (file.originalname || "").toLowerCase();
  try {
    if (name.endsWith(".csv")) {
      const { Readable } = await import("node:stream");
      await wb.csv.read(Readable.from([file.buffer]));
    } else if (name.endsWith(".xlsx")) await wb.xlsx.load(file.buffer);
    else throw badRequest("Upload a .xlsx or .csv file");
  } catch (err) {
    if (err.status) throw err;
    throw badRequest("The file could not be read. Use the downloadable template.");
  }
  const ws = wb.worksheets[0];
  if (!ws) throw badRequest("The file has no data");
  const headerRow = ws.getRow(1).values.slice(1).map((h) => norm(typeof h === "object" && h ? h.text ?? h.result : h));
  const map = def.columns.map((c) => headerRow.indexOf(norm(c)));
  const missing = def.columns.filter((c, i) => map[i] === -1 && !["phone", "projectTitle", "teamId", "sections", "memberRolls"].includes(c));
  if (missing.length) throw badRequest(`Missing required column(s): ${missing.join(", ")}. Download the template for the expected layout.`);
  const rows = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const vals = row.values.slice(1);
    const raw = {};
    def.columns.forEach((c, i) => {
      let cell = map[i] === -1 ? "" : vals[map[i]];
      if (cell && typeof cell === "object") cell = cell.text ?? cell.result ?? "";
      raw[c] = String(cell ?? "").trim();
    });
    if (Object.values(raw).some(Boolean)) rows.push({ rowNumber: n, raw });
  });
  if (!rows.length) throw badRequest("The file has no data rows");
  if (rows.length > MAX_ROWS) throw badRequest(`Too many rows (${rows.length}). The limit is ${MAX_ROWS} per import.`);
  return rows;
}

const sectionMap = async () => new Map((await Section.find({ isActive: true }).lean()).map((s) => [s.name.toLowerCase(), s]));
const splitList = (s) => String(s || "").split(/[;,]/).map((x) => x.trim().toUpperCase()).filter(Boolean);

/** Validates every row without writing anything. */
export async function validateRows(type, rows, actor) {
  const out = rows.map((r) => ({ ...r, status: "valid", errors: [], normalized: null }));
  const err = (row, m) => { row.errors.push(m); if (row.status === "valid") row.status = "error"; };
  const dup = (row, m) => { row.errors.push(m); if (row.status === "valid") row.status = "duplicate"; };
  const sections = await sectionMap();
  const settings = await getSettings();

  if (type === "students") {
    const emails = out.map((r) => r.raw.email.toLowerCase()).filter(Boolean);
    const rolls = out.map((r) => r.raw.rollNumber.toUpperCase()).filter(Boolean);
    const [exE, exR] = await Promise.all([User.find({ email: { $in: emails } }, "email").lean(), User.find({ rollNumber: { $in: rolls } }, "rollNumber").lean()]);
    const seenE = new Set(exE.map((u) => u.email));
    const seenR = new Set(exR.map((u) => u.rollNumber));
    const inFileE = new Set();
    const inFileR = new Set();
    const addedBySection = new Map();
    for (const row of out) {
      const { rollNumber, name, email, section, phone } = row.raw;
      const sec = sections.get(section.toLowerCase());
      if (!rollNumber) err(row, "Roll number is required");
      if (!name) err(row, "Name is required");
      if (!EMAIL.test(email)) err(row, "A valid email is required");
      if (!sec) err(row, `Unknown section "${section}"`);
      else if (actor.role === "coordinator" && !actor.sections.includes(String(sec._id))) err(row, `You are not assigned to section ${sec.name}`);
      if (phone && phone.length > 20) err(row, "Phone is too long");
      const e = email.toLowerCase();
      const r = rollNumber.toUpperCase();
      if (seenE.has(e)) dup(row, "Email already exists – row skipped, existing record unchanged");
      if (seenR.has(r)) dup(row, "Roll number already exists – row skipped, existing record unchanged");
      if (inFileE.has(e)) dup(row, "Duplicate email earlier in this file");
      if (inFileR.has(r)) dup(row, "Duplicate roll number earlier in this file");
      inFileE.add(e); inFileR.add(r);
      if (row.status === "valid") {
        const used = (addedBySection.get(String(sec._id)) ?? (await User.countDocuments({ role: "student", section: sec._id, isActive: true })));
        const cap = await sectionCapacity(sec);
        if (cap && used + 1 > cap) err(row, `Section ${sec.name} is at capacity (${cap})`);
        else { addedBySection.set(String(sec._id), used + 1); row.normalized = { name, email: e, rollNumber: r, phone: phone || undefined, section: String(sec._id), role: "student" }; }
      }
    }
  } else if (type === "staff") {
    const exE = new Set((await User.find({ email: { $in: out.map((r) => r.raw.email.toLowerCase()) } }, "email").lean()).map((u) => u.email));
    const inFile = new Set();
    for (const row of out) {
      const { name, email, role, sections: secs } = row.raw;
      const e = email.toLowerCase();
      if (!name) err(row, "Name is required");
      if (!EMAIL.test(email)) err(row, "A valid email is required");
      if (!["guide", "coordinator"].includes(role.toLowerCase())) err(row, "Role must be guide or coordinator");
      const ids = [];
      if (role.toLowerCase() === "coordinator") {
        const names = secs.split(/[;,]/).map((x) => x.trim()).filter(Boolean);
        if (!names.length) err(row, "Coordinators need at least one section");
        for (const n of names) { const s = sections.get(n.toLowerCase()); if (!s) err(row, `Unknown section "${n}"`); else ids.push(String(s._id)); }
      }
      if (exE.has(e)) dup(row, "Email already exists – row skipped, existing record unchanged");
      if (inFile.has(e)) dup(row, "Duplicate email earlier in this file");
      inFile.add(e);
      if (row.status === "valid") row.normalized = { name, email: e, role: role.toLowerCase(), sections: ids };
    }
  } else {
    const rolls = [...new Set(out.flatMap((r) => [r.raw.leaderRoll.toUpperCase(), ...splitList(r.raw.memberRolls)]).filter(Boolean))];
    const students = await User.find({ rollNumber: { $in: rolls }, role: "student", isActive: true }, "rollNumber team section").lean();
    const byRoll = new Map(students.map((s) => [s.rollNumber, s]));
    const guides = await User.find({ role: "guide", isActive: true, email: { $in: out.map((r) => r.raw.guideEmail.toLowerCase()) } }, "email").lean();
    const guideBy = new Map(guides.map((g) => [g.email, g]));
    const load = new Map((await Team.aggregate([{ $match: { status: "active" } }, { $group: { _id: "$guide", n: { $sum: 1 } } }])).map((x) => [String(x._id), x.n]));
    const existingIds = new Set((await Team.find({ teamId: { $in: out.map((r) => r.raw.teamId.toUpperCase()).filter(Boolean) } }, "teamId").lean()).map((t) => t.teamId));
    const usedRolls = new Set();
    const usedIds = new Set();
    for (const row of out) {
      const { teamId, section, guideEmail, projectTitle, leaderRoll } = row.raw;
      const sec = sections.get(section.toLowerCase());
      const guide = guideBy.get(guideEmail.toLowerCase());
      const members = splitList(row.raw.memberRolls);
      const leader = leaderRoll.toUpperCase();
      if (leader && !members.includes(leader)) members.unshift(leader);
      if (!sec) err(row, `Unknown section "${section}"`);
      else if (actor.role === "coordinator" && !actor.sections.includes(String(sec._id))) err(row, `You are not assigned to section ${sec.name}`);
      if (!guide) err(row, `No active guide with email "${guideEmail}"`);
      else {
        const n = (load.get(String(guide._id)) || 0) + 1;
        if (n > settings.guide.maxTeams) err(row, `Guide workload limit (${settings.guide.maxTeams}) would be exceeded`);
        else load.set(String(guide._id), n);
      }
      if (!members.length) err(row, "A team needs at least one member (leaderRoll / memberRolls)");
      if (members.length > settings.team.maxSize) err(row, `Too many members (max ${settings.team.maxSize})`);
      for (const roll of members) {
        const s = byRoll.get(roll);
        if (!s) err(row, `Student ${roll} not found`);
        else if (s.team) dup(row, `Student ${roll} already belongs to a team – row skipped`);
        else if (sec && String(s.section) !== String(sec._id)) err(row, `Student ${roll} is not in section ${sec.name}`);
        if (usedRolls.has(roll)) dup(row, `Student ${roll} appears in an earlier team row`);
      }
      const tid = teamId.toUpperCase();
      if (tid && !/^[A-Z0-9][A-Z0-9_-]{1,29}$/.test(tid)) err(row, "Invalid team id format");
      if (tid && (existingIds.has(tid) || usedIds.has(tid))) dup(row, `Team id ${tid} already exists – row skipped, existing record unchanged`);
      if (tid) usedIds.add(tid);
      members.forEach((m) => usedRolls.add(m));
      if (row.status === "valid") row.normalized = { teamId: tid || null, section: String(sec._id), guide: String(guide._id), projectTitle: projectTitle || "", leaderRoll: leader || members[0], members };
    }
  }
  return out;
}

/** Applies validated rows. Existing records are never updated; failures are reported per row. */
export async function applyRows(type, job, actor) {
  const result = { created: 0, skipped: 0, failed: 0, failures: [] };
  for (const row of job.rows) {
    if (row.status !== "valid") { result.skipped++; continue; }
    const n = row.normalized;
    try {
      // capacity is re-checked here (atomically) because it may have changed since the preview
      if (type === "students") await createStudentWithSeat({ ...n, createdBy: actor._id });
      else if (type === "staff") await User.create({ ...n, createdBy: actor._id });
      else {
        const section = await Section.findById(n.section).lean();
        await reserveGuideSlot(n.guide); // re-checked atomically at confirmation time
        let team;
        try {
          team = await Team.create({ teamId: n.teamId || (await generateTeamId(section)), section: n.section, guide: n.guide, projectTitle: n.projectTitle, titleStatus: n.projectTitle ? "submitted" : "not_submitted", createdBy: actor._id });
        } catch (e) {
          await releaseGuideSlot(n.guide);
          throw e;
        }
        try {
          for (const roll of n.members) { const s = await User.findOne({ rollNumber: roll }, "_id").lean(); await addMember(team, s._id); }
          const leader = await User.findOne({ rollNumber: n.leaderRoll }, "_id").lean();
          await Team.updateOne({ _id: team._id }, { $set: { leader: leader._id } });
        } catch (e) {
          await User.updateMany({ team: team._id }, { $set: { team: null } });
          await Team.deleteOne({ _id: team._id });
          await releaseGuideSlot(n.guide);
          throw e;
        }
      }
      result.created++;
    } catch (e) {
      result.failed++;
      result.failures.push(`Row ${row.rowNumber}: ${e.message}`);
    }
  }
  return result;
}
