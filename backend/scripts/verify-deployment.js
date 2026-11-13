// Read-only deployment check for a staging/production environment (e.g. MongoDB Atlas). It never changes data.
//   npm run verify:deployment                    -> checks config, database, indexes, counters, uploads, mail, scanner, redis
//   npm run verify:deployment -- --send-test-email=you@college.edu   -> additionally sends ONE test email
// Exit code 1 when any check FAILS (warnings do not fail).
import mongoose from "mongoose";
import { assertEnv, env } from "../src/config/env.js";
import { connectDb } from "../src/config/db.js";
import { reconcileCounters } from "../src/shared/counters.js";
import { ensureUploadDir } from "../src/shared/upload.js";
import { mailConfigured, sendMail } from "../src/shared/mail.js";
import "../src/models/User.js"; import "../src/models/BookingRequest.js"; import "../src/models/BookingSlot.js"; import "../src/models/Notification.js"; import "../src/models/Team.js"; import "../src/models/Section.js";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";

const results = [];
const rec = (level, name, detail = "") => { results.push({ level, name }); console.log(`${{ PASS: "✔ PASS", WARN: "▲ WARN", FAIL: "✖ FAIL" }[level]}  ${name}${detail ? ` — ${detail}` : ""}`); };
const step = async (name, fn) => { try { await fn(); } catch (e) { rec("FAIL", name, e.message); } };

await step("configuration", async () => {
  try { assertEnv(env); rec("PASS", "configuration is valid for NODE_ENV=" + env.nodeEnv); } catch (e) { rec("FAIL", "configuration", e.message); }
  if (!env.isProd) rec("WARN", "NODE_ENV is not production", "run this check with the real production/staging environment variables");
});

let dbOk = false;
await step("database connection", async () => {
  await connectDb(env.mongoUri, { readOnly: true }); // strictly read-only: Mongoose must not create collections or indexes as a side effect
  dbOk = true;
  const db = mongoose.connection.db;
  const hello = await db.admin().command({ hello: 1 });
  let version = "unknown";
  try { version = (await db.admin().command({ buildInfo: 1 })).version; } catch { rec("WARN", "could not read server version (insufficient privileges)"); }
  const major = Number.parseInt(version, 10);
  rec("PASS", "connected to MongoDB", `version ${version}, ${hello.setName ? `replica set "${hello.setName}"` : "standalone"}`);
  if (Number.isFinite(major)) rec(major >= 5 ? "PASS" : "FAIL", "MongoDB version supports the dashboard aggregation ($lookup with pipeline)", "needs >= 5.0");
  if (!hello.setName) rec("WARN", "standalone MongoDB (no replica set)", "supported: the app does not use transactions, but Atlas/production should use a replica set for durability");
});

if (dbOk) {
  await step("indexes", async () => {
    const need = [
      ["users", { email: 1 }, true], ["users", { rollNumber: 1 }, true],
      ["teams", { teamId: 1 }, true],
      ["bookingrequests", { slot: 1 }, true], ["bookingrequests", { team: 1, reviewKey: 1 }, true],
      ["bookingslots", { guide: 1, date: 1, startMin: 1 }, true],
      ["notifications", { recipient: 1, dedupeKey: 1 }, true],
    ];
    for (const [coll, key, unique] of need) {
      const idx = await mongoose.connection.db.collection(coll).indexes().catch(() => []);
      const ok = idx.some((i) => JSON.stringify(i.key) === JSON.stringify(key) && Boolean(i.unique) === unique);
      rec(ok ? "PASS" : "FAIL", `index ${coll} ${JSON.stringify(key)}${unique ? " (unique)" : ""}`, ok ? "" : "missing: start the API once so it can build indexes (these guarantee no double booking)");
    }
  });
  await step("counters", async () => {
    const drift = await reconcileCounters({ dryRun: true });
    const n = drift.sections.length + drift.guides.length;
    rec(n ? "WARN" : "PASS", n ? `${n} seat/workload counter(s) differ from real data` : "seat and guide-workload counters match real data", n ? "run POST /api/sections/reconcile as HOD (or restart the API)" : "");
  });
}

await step("uploads", async () => {
  await ensureUploadDir();
  rec("PASS", "upload directory is writable", env.uploadDir);
  if (env.isProd && !env.uploadDirExplicit) rec("WARN", "UPLOAD_DIR is not set", "use a persistent volume and set it explicitly");
});

await step("mail", async () => {
  if (!mailConfigured()) { rec(env.isProd ? "FAIL" : "WARN", "email is not configured", "sign-in codes cannot be delivered"); return; }
  rec("PASS", "email credentials are present");
  const arg = process.argv.find((a) => a.startsWith("--send-test-email="));
  if (arg) { await sendMail({ to: arg.split("=")[1], subject: "Review Management System: test email", text: "Delivery check from verify-deployment." }); rec("PASS", "test email accepted by SMTP", arg.split("=")[1]); }
  else rec("WARN", "delivery not tested", "re-run with --send-test-email=you@college.edu");
});

await step("upload scanner", async () => {
  if (!env.scanner.bin) { rec("WARN", "no upload scanner configured", "uploads are validated by type/size/signature only; set UPLOAD_SCANNER_BIN to add antivirus scanning"); return; }
  const tmp = path.join(os.tmpdir(), `scan-check-${process.pid}.txt`);
  await fs.writeFile(tmp, "harmless text file");
  await new Promise((resolve) => execFile(env.scanner.bin, env.scanner.args.map((a) => a.replaceAll("{file}", tmp)), { timeout: env.scanner.timeoutMs }, (err) => { rec(err ? "FAIL" : "PASS", "scanner reports a harmless file as clean", err ? `exit ${err.code ?? err.message}` : ""); resolve(); }));
  await fs.rm(tmp, { force: true });
});

if (env.redisUrl) {
  await step("redis", async () => {
    const { createClient } = await import("redis");
    const c = createClient({ url: env.redisUrl });
    c.on("error", () => {});
    await c.connect();
    rec((await c.ping()) === "PONG" ? "PASS" : "FAIL", "Redis (Socket.IO adapter) answers PING");
    await c.quit();
  });
} else rec("WARN", "REDIS_URL not set", "fine for ONE API instance; with several instances realtime hints reach only users on the same instance");

await mongoose.disconnect().catch(() => {});
const failed = results.filter((r) => r.level === "FAIL").length;
console.log(`\n${results.filter((r) => r.level === "PASS").length} passed, ${results.filter((r) => r.level === "WARN").length} warnings, ${failed} failed`);
process.exit(failed ? 1 : 0);
