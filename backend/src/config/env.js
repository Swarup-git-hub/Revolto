import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(root, ".env"), quiet: true });

const int = (v, d) => {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) ? n : d;
};
const bool = (v, d) => (v === undefined || v === "" ? d : !["false", "0", "no", "off"].includes(String(v).toLowerCase()));
const list = (v, d) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : d);

const nodeEnv = process.env.NODE_ENV || "development";
const isProd = nodeEnv === "production";

export const env = {
  nodeEnv,
  isProd,
  isTest: nodeEnv === "test",
  port: int(process.env.PORT, 5000),
  mongoUri: process.env.MONGO_URI || "mongodb://127.0.0.1:27017/reviewslot",
  corsOrigins: list(process.env.CORS_ORIGIN || process.env.FRONTEND_URL, ["http://localhost:5173"]),
  jwtSecret: process.env.JWT_SECRET || "",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  otp: {
    expiryMinutes: int(process.env.OTP_EXPIRY_MINUTES, 5),
    resendCooldownSeconds: int(process.env.OTP_RESEND_COOLDOWN_SECONDS, 60),
    maxRequestsPerHour: int(process.env.OTP_MAX_REQUESTS_PER_HOUR, 5),
    maxVerifyAttempts: int(process.env.OTP_MAX_VERIFY_ATTEMPTS, 5),
    devFixed: process.env.DEV_FIXED_OTP || "",
  },
  mail: {
    user: process.env.GMAIL_USER || "",
    pass: process.env.GMAIL_APP_PASSWORD || "",
    fromName: process.env.MAIL_FROM_NAME || "Review Management System",
  },
  uploadDir: path.resolve(root, process.env.UPLOAD_DIR || "./uploads"),
  uploadDirExplicit: Boolean(process.env.UPLOAD_DIR),
  /** Number of reverse-proxy hops in front of the API (used for the client IP seen by rate limiting). */
  trustProxy: int(process.env.TRUST_PROXY, 1),
  rateLimit: {
    enabled: bool(process.env.RATE_LIMIT_ENABLED, nodeEnv !== "test"),
    windowMs: int(process.env.RATE_LIMIT_WINDOW_MINUTES, 15) * 60000,
    max: int(process.env.RATE_LIMIT_MAX, 6000), // all API calls, per IP per window (generous: a campus often shares ONE public IP)
    authMax: int(process.env.RATE_LIMIT_AUTH_MAX, 300), // sign-in endpoints, per IP per window (brute force is already limited per account by the OTP rules)
    exportMax: int(process.env.RATE_LIMIT_EXPORT_MAX, 30),
    uploadMax: int(process.env.RATE_LIMIT_UPLOAD_MAX, 300), // review submissions (file uploads)
  },
  /** Optional antivirus hook: an executable run on every upload. Exit 0 = clean, 1 = infected, anything else = scanner error. */
  scanner: {
    bin: process.env.UPLOAD_SCANNER_BIN || "",
    args: (() => { try { const a = JSON.parse(process.env.UPLOAD_SCANNER_ARGS || '["{file}"]'); return Array.isArray(a) && a.every((x) => typeof x === "string") ? a : null; } catch { return null; } })(),
    timeoutMs: int(process.env.UPLOAD_SCANNER_TIMEOUT_MS, 30000),
    /** true = if the scanner itself fails or times out, reject the upload (fail closed). */
    required: bool(process.env.UPLOAD_SCAN_REQUIRED, false),
  },
  /** Optional: share Socket.IO events between several API instances through Redis. */
  redisUrl: process.env.REDIS_URL || "",
  hod: { email: process.env.HOD_EMAIL || "", name: process.env.HOD_NAME || "Head of Department" },
};

/** Fail fast on unsafe configuration. Called once at boot (not at import, so tests can set env first). */
export function assertEnv(cfg = env) {
  const problems = [];
  if (!cfg.jwtSecret) problems.push("JWT_SECRET is required");
  if (cfg.isProd && cfg.jwtSecret.length < 32) problems.push("JWT_SECRET must be at least 32 characters in production");
  if (cfg.isProd && cfg.otp.devFixed) problems.push("DEV_FIXED_OTP must not be set in production");
  if (cfg.otp.devFixed && !/^\d{6}$/.test(cfg.otp.devFixed)) problems.push("DEV_FIXED_OTP must be exactly 6 digits");
  if (cfg.scanner?.bin && !cfg.scanner.args) problems.push('UPLOAD_SCANNER_ARGS must be a JSON array of strings, e.g. ["--no-summary","{file}"]');
  if (cfg.isProd && cfg.rateLimit && !cfg.rateLimit.enabled) problems.push("RATE_LIMIT_ENABLED must not be false in production (or enforce limits at your proxy and set RATE_LIMIT_ENABLED=true anyway)");
  // Sign-in codes are delivered by email, so production cannot run without working SMTP settings.
  if (cfg.isProd && !cfg.mail.user) problems.push("GMAIL_USER is required in production (sign-in codes are sent by email)");
  if (cfg.isProd && !cfg.mail.pass) problems.push("GMAIL_APP_PASSWORD is required in production (sign-in codes are sent by email)");
  if (problems.length) throw new Error(`Invalid configuration: ${problems.join("; ")}`);
}
