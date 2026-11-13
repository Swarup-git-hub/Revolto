// Read-only check of data invariants (teams/leaders, seat & workload counters, booking integrity, submission versions).
//   npm run check:consistency        exit code 1 if any violation is found (warnings do not fail)
import mongoose from "mongoose";
import { connectDb } from "../src/config/db.js";
import { env } from "../src/config/env.js";
import { checkConsistency } from "../src/shared/consistency.js";

await connectDb(env.mongoUri, { readOnly: true });
const findings = await checkConsistency();
for (const f of findings) console.log(`${f.level === "violation" ? "✖ VIOLATION" : "▲ warning  "}  [${f.rule}] ${f.detail}`);
const violations = findings.filter((f) => f.level === "violation").length;
console.log(violations || findings.length ? `\n${violations} violation(s), ${findings.length - violations} warning(s)` : "✔ All consistency checks passed.");
await mongoose.disconnect();
process.exit(violations ? 1 : 0);
