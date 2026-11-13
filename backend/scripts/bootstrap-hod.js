// Creates the first HOD account (idempotent). Usage: HOD_EMAIL=you@college.edu npm run bootstrap:hod
import mongoose from "mongoose";
import { env } from "../src/config/env.js";
import { connectDb } from "../src/config/db.js";
import User from "../src/models/User.js";
import { ensureDefaultReviews } from "../src/modules/reviews/reviewConfig.service.js";
import { getSettings } from "../src/shared/settings.js";

if (!env.hod.email) {
  console.error("Set HOD_EMAIL (and optionally HOD_NAME) in backend/.env first.");
  process.exit(1);
}
await connectDb();
await getSettings();
await ensureDefaultReviews();
const existing = await User.findOne({ email: env.hod.email.toLowerCase() });
if (existing) console.log(`A user with that email already exists (role: ${existing.role}). Nothing changed.`);
else {
  await User.create({ name: env.hod.name, email: env.hod.email, role: "hod" });
  console.log("HOD account created. Sign in with that email using the one-time code.");
}
await mongoose.disconnect();
