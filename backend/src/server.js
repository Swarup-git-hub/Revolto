import http from "node:http";
import { assertEnv, env } from "./config/env.js";
import { connectDb } from "./config/db.js";
import { createApp } from "./app.js";
import { attachRedisAdapter, initSocket } from "./shared/socket.js";
import { ensureUploadDir } from "./shared/upload.js";
import { ensureDefaultReviews } from "./modules/reviews/reviewConfig.service.js";
import { getSettings } from "./shared/settings.js";
import { mailConfigured } from "./shared/mail.js";
import { reconcileCounters } from "./shared/counters.js";

assertEnv();
await connectDb();
await getSettings();
await ensureDefaultReviews();
{
  // Derived counters (seats, guide workload) are recomputed from real data before serving traffic.
  const fixed = await reconcileCounters();
  if (fixed.sections.length || fixed.guides.length) console.log(`Counters reconciled: ${fixed.sections.length} section(s), ${fixed.guides.length} guide(s) corrected`);
}

// Make sure partial unique indexes (double-booking protection etc.) exist before serving traffic.
const { default: mongoose } = await import("mongoose");
await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes().catch((e) => console.warn(`Index sync skipped for ${m.modelName}: ${e.message}`))));

try {
  await ensureUploadDir();
} catch (err) {
  if (env.isProd) throw new Error(`UPLOAD_DIR (${env.uploadDir}) is not writable: ${err.message}`);
  console.warn(`Upload directory is not writable (${err.message}); file uploads will fail.`);
}
if (env.isProd && !env.uploadDirExplicit) console.warn("UPLOAD_DIR is not set: uploads go to the default ./uploads folder. Mount a persistent volume and set UPLOAD_DIR, or files are lost when the container is replaced.");

const server = http.createServer(createApp());
const io = initSocket(server, env.corsOrigins);
if (env.redisUrl) await attachRedisAdapter(io, env.redisUrl);
server.listen(env.port, () => {
  console.log(`API listening on port ${env.port} (${env.nodeEnv})`);
  if (!mailConfigured()) console.warn("Email is not configured (GMAIL_USER / GMAIL_APP_PASSWORD). OTP and booking emails will not be delivered.");
});

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.close(() => mongoose.disconnect().then(() => process.exit(0))));
