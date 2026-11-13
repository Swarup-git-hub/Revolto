// Recomputes seat (Section.studentCount) and guide-workload (User.activeTeamCount) counters from real data.
// Usage: npm run reconcile:counters            (applies and prints every correction)
//        npm run reconcile:counters -- --dry-run (prints differences only)
import mongoose from "mongoose";
import { connectDb } from "../src/config/db.js";
import { reconcileCounters } from "../src/shared/counters.js";

await connectDb();
const result = await reconcileCounters({ dryRun: process.argv.includes("--dry-run") });
console.log(JSON.stringify(result, null, 2));
await mongoose.disconnect();
