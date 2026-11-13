// Migrates a v1 (ReviewSlotBooking) database in place to the v2 schema.
//   node scripts/migrate-v1-to-v2.js                      -> DRY RUN (default): prints what would change
//   node scripts/migrate-v1-to-v2.js --apply              -> applies; first writes migration-backup-<time>.json
//   node scripts/migrate-v1-to-v2.js --rollback <file>    -> restores users/teams from a backup file
// Legacy collections (sessions, slots, requests, overrides, configs) are NEVER modified or dropped.
import fs from "node:fs";
import mongoose from "mongoose";
import { connectDb } from "../src/config/db.js";

const { EJSON } = mongoose.mongo.BSON; // Extended JSON keeps ObjectIds and Dates intact in the backup
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const rbIdx = args.indexOf("--rollback");
const sectionName = (args.find((a) => a.startsWith("--section-name=")) || "--section-name=A").split("=")[1];

await connectDb();
const db = mongoose.connection.db;
const users = db.collection("users");
const teams = db.collection("teams");
const sections = db.collection("sections");

if (rbIdx !== -1) {
  const file = args[rbIdx + 1];
  if (!file || !fs.existsSync(file)) { console.error("Give the backup file path: --rollback <migration-backup-....json>"); process.exit(1); }
  const snap = EJSON.parse(fs.readFileSync(file, "utf8"));
  // Replace each backed-up document exactly as it was (this also restores fields the migration removed).
  for (const [col, docs] of Object.entries(snap)) for (const d of docs) await db.collection(col).replaceOne({ _id: d._id }, d, { upsert: true });
  console.log(`Restored ${Object.values(snap).reduce((n, d) => n + d.length, 0)} documents from ${file}.`);
  await mongoose.disconnect();
  process.exit(0);
}

const plan = { adminToHod: 0, studentsWithoutSection: 0, teamsToUpgrade: 0, transientOtpFieldsCleared: 0 };
const adminUsers = await users.find({ role: "admin" }).toArray();
const studentsNoSection = await users.find({ role: "student", section: { $exists: false } }).toArray();
const oldTeams = await teams.find({ teamId: { $exists: false } }).toArray();
plan.adminToHod = adminUsers.length;
plan.studentsWithoutSection = studentsNoSection.length;
plan.teamsToUpgrade = oldTeams.length;
plan.transientOtpFieldsCleared = await users.countDocuments({ $or: [{ otp: { $type: "string" } }, { otpExpiry: { $exists: true } }] });
console.log(apply ? "APPLYING migration:" : "DRY RUN (no changes written). Re-run with --apply to execute.");
console.table(plan);
console.log(`Students and teams without a section will be placed in section "${sectionName}" (override with --section-name=X). Reassign them afterwards in the app.`);

if (apply) {
  const backupFile = `migration-backup-${Date.now()}.json`;
  const snap = { users: await users.find({}).toArray(), teams: await teams.find({}).toArray() };
  fs.writeFileSync(backupFile, EJSON.stringify(snap, { relaxed: false }));
  console.log(`Backup written: ${backupFile}`);

  let section = await sections.findOne({ name: sectionName });
  if (!section) { const r = await sections.insertOne({ name: sectionName, capacity: null, isActive: true, archivedAt: null, booking: { enabled: null, requestBy: null, cutoffHoursBeforeSlot: null }, createdAt: new Date(), updatedAt: new Date() }); section = { _id: r.insertedId }; }

  await users.updateMany({ role: "admin" }, { $set: { role: "hod" }, $inc: { tokenVersion: 1 } });
  await users.updateMany({ role: "student", section: { $exists: false } }, { $set: { section: section._id } });
  await users.updateMany({ role: { $in: ["guide", "hod", "student"] }, sections: { $exists: false } }, { $set: { sections: [] } });
  await users.updateMany({ tokenVersion: { $exists: false } }, { $set: { tokenVersion: 0 } });
  // login codes were stored in plain text in v1; discard them (users simply request a new code)
  await users.updateMany({}, { $unset: { otp: "", otpExpiry: "", otpAttempts: "", lastOtpRequestTime: "", refreshToken: "" } });

  let n = 0;
  for (const t of oldTeams) {
    const base = String(t.name || `TEAM${++n}`).toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28) || `TEAM${++n}`;
    let teamId = base;
    for (let i = 2; await teams.findOne({ teamId }); i++) teamId = `${base}-${i}`;
    const memberIds = (t.members || []).map(String);
    if (memberIds.length) await users.updateMany({ _id: { $in: (t.members || []) }, team: { $in: [null, undefined] } }, { $set: { team: t._id } });
    await teams.updateOne({ _id: t._id }, { $set: { teamId, section: section._id, leader: (t.members || [])[0] || null, projectTitle: t.projectTitle || "", titleStatus: "not_submitted", titleHistory: [], status: t.isActive === false ? "archived" : "active" } });
  }
  console.log("Migration applied. Start the server to create the new indexes and default reviews.");
}
await mongoose.disconnect();
