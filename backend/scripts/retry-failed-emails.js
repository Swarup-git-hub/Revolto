// Re-sends notification emails that failed earlier. Safe to run repeatedly (e.g. from cron every few minutes):
// it only updates existing delivery records, gives up after 3 attempts, and never creates new notifications.
import mongoose from "mongoose";
import { connectDb } from "../src/config/db.js";
import { retryFailedEmails } from "../src/shared/notify.js";

await connectDb();
console.log("Email retry result:", await retryFailedEmails());
await mongoose.disconnect();
