// Adds DEMO data for local evaluation. Additive only (never deletes). Refuses to run in production.
// Sign in as any demo user with DEV_FIXED_OTP set in backend/.env (e.g. 123456).
import mongoose from "mongoose";
import { env } from "../src/config/env.js";
import { connectDb } from "../src/config/db.js";
import Section from "../src/models/Section.js";
import Team from "../src/models/Team.js";
import User from "../src/models/User.js";
import { ensureDefaultReviews } from "../src/modules/reviews/reviewConfig.service.js";
import { getSettings } from "../src/shared/settings.js";

if (env.isProd) { console.error("Refusing to seed demo data in production."); process.exit(1); }
await connectDb();
await getSettings();
await ensureDefaultReviews();
const upsertUser = async (email, fields) => (await User.findOne({ email })) || User.create({ email, ...fields });

const [a, b] = await Promise.all(["A", "B"].map(async (name) => (await Section.findOne({ name })) || Section.create({ name })));
await upsertUser("hod@example.edu", { name: "Dr. Meera Iyer (HOD)", role: "hod" });
await upsertUser("coordinator.a@example.edu", { name: "Prof. Anil Kumar (Coordinator A)", role: "coordinator", sections: [a._id] });
await upsertUser("coordinator.b@example.edu", { name: "Prof. Sunita Rao (Coordinator B)", role: "coordinator", sections: [b._id] });
const g1 = await upsertUser("guide1@example.edu", { name: "Dr. Ravi Shankar", role: "guide" });
const g2 = await upsertUser("guide2@example.edu", { name: "Dr. Lakshmi Devi", role: "guide" });

const students = [];
for (let i = 1; i <= 8; i++) {
  const sec = i <= 4 ? a : b;
  students.push(await upsertUser(`student${i}@example.edu`, { name: `Student ${i}`, role: "student", rollNumber: `22CS${String(i).padStart(3, "0")}`, section: sec._id }));
}
const mk = async (teamId, sec, guide, members, title) => {
  let t = await Team.findOne({ teamId });
  if (!t) t = await Team.create({ teamId, section: sec._id, guide: guide._id, leader: members[0]._id, projectTitle: title, titleStatus: title ? "submitted" : "not_submitted" });
  await User.updateMany({ _id: { $in: members.map((m) => m._id) }, team: null }, { $set: { team: t._id } });
};
await mk("A-T01", a, g1, students.slice(0, 2), "Smart Attendance System");
await mk("A-T02", a, g2, students.slice(2, 4), "");
await mk("B-T01", b, g1, students.slice(4, 6), "Library Resource Planner");
await mk("B-T02", b, g2, students.slice(6, 8), "");
console.log("Demo data ready. Users: hod@example.edu, coordinator.a@example.edu, guide1@example.edu, student1@example.edu (leader of A-T01), ...");
await mongoose.disconnect();
