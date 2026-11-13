import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildWorld, client, pdf, serve, startApp } from "./helpers.js";
import { assertEnv, env } from "../src/config/env.js";
import { ensureUploadDir, resolveStoredFile } from "../src/shared/upload.js";
import Submission from "../src/models/Submission.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCANNER = path.join(here, "fixtures", "fake-scanner.mjs");
let app, w, leader, guide;
before(async () => {
  app = await startApp("hardening");
  w = await buildWorld(app.url);
  leader = await w.api(w.users.st[0]); guide = await w.api(w.users.g1);
  await ensureUploadDir(); // the server does this at boot
});
after(async () => { fs.rmSync(env.uploadDir, { recursive: true, force: true }); await app.stop(); });

const LIMITS = (o = {}) => ({ rateLimit: { enabled: true, windowMs: 60000, max: 100, authMax: 100, exportMax: 100, uploadMax: 100, ...o } });
const get = (url, p, token) => fetch(`${url}${p}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

/* ------------------------------ rate limiting ------------------------------ */
test("rate limiting is off in the test environment by default and on when enabled", async () => {
  assert.equal(env.rateLimit.enabled, false);
  for (let i = 0; i < 40; i++) assert.equal((await client(app.url).post("/auth/send-otp", { email: "nobody@t.edu" })).status, 200);
});

test("global limit: requests above the limit get 429 with a JSON message and standard RateLimit headers", async () => {
  const s = await serve(LIMITS({ max: 6 }));
  const token = await w.tok(w.users.hod);
  const statuses = [];
  let last;
  for (let i = 0; i < 9; i++) { last = await get(s.url, "/settings", token); statuses.push(last.status); }
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 200, 429, 429, 429]);
  assert.match((await last.json()).error, /Too many requests/);
  assert.ok(last.headers.get("ratelimit") || last.headers.get("ratelimit-policy"), "standard rate-limit headers are sent");
  await s.stop();
});

test("sign-in endpoints have a tighter limit than the rest of the API", async () => {
  const s = await serve(LIMITS({ authMax: 3 }));
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await client(s.url).post("/auth/send-otp", { email: "nobody@t.edu" })).status);
  assert.deepEqual(codes, [200, 200, 200, 429, 429]);
  assert.equal((await get(s.url, "/settings", await w.tok(w.users.hod))).status, 200, "the rest of the API is still available");
  await s.stop();
});

test("export and upload endpoints have their own limits", async () => {
  const s = await serve(LIMITS({ exportMax: 2, uploadMax: 2 }));
  const token = await w.tok(w.users.hod);
  assert.deepEqual([(await get(s.url, "/exports/teams.csv", token)).status, (await get(s.url, "/exports/teams.csv", token)).status, (await get(s.url, "/exports/teams.csv", token)).status], [200, 200, 429]);
  const lt = await w.tok(w.users.st[0]);
  const post = () => fetch(`${s.url}/teams/A-T01/reviews/review-4/submissions`, { method: "POST", headers: { Authorization: `Bearer ${lt}`, "Content-Type": "application/json" }, body: "{}" });
  const r = [(await post()).status, (await post()).status, (await post()).status];
  assert.equal(r[2], 429);
  assert.notEqual(r[0], 429);
  await s.stop();
});

test("liveness and readiness probes are never throttled", async () => {
  const s = await serve(LIMITS({ max: 2 }));
  for (let i = 0; i < 15; i++) assert.equal((await get(s.url, "/health")).status, 200);
  for (let i = 0; i < 15; i++) assert.equal((await get(s.url, "/health/ready")).status, 200);
  await s.stop();
});

/* ------------------------------ readiness ------------------------------ */
test("readiness reports database and upload-directory state (503 when uploads are unavailable)", async () => {
  const ok = await (await get(app.url, "/health/ready")).json();
  assert.deepEqual(ok, { status: "ready", db: true, uploads: true });
  const saved = env.uploadDir;
  env.uploadDir = path.join(saved, "does", "not", "exist");
  const bad = await get(app.url, "/health/ready");
  env.uploadDir = saved;
  assert.equal(bad.status, 503);
  assert.deepEqual(await bad.json(), { status: "not_ready", db: true, uploads: false });
});

/* ------------------------------ secure file delivery ------------------------------ */
test("downloads are attachments with no-sniff, sandbox CSP, no caching; tampered paths never read outside the upload dir", async () => {
  const up = await leader.upload("/teams/A-T01/reviews/review-4/submissions", {}, { name: "final.pdf", buffer: pdf("secure") });
  assert.equal(up.status, 201);
  const id = up.body.submission.id;
  const res = await fetch(`${app.url}/submissions/${id}/file`, { headers: { Authorization: `Bearer ${await w.tok(w.users.st[0])}` } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition"), /^attachment/);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.match(res.headers.get("content-security-policy"), /sandbox/);
  assert.match(res.headers.get("cache-control"), /no-store/);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  // path traversal: both the helper and the route refuse a stored name that escapes the upload directory
  assert.throws(() => resolveStoredFile("../../etc/passwd"), /Invalid file reference/);
  assert.throws(() => resolveStoredFile(`${env.uploadDir}/../outside`), /Invalid file reference/);
  await Submission.updateOne({ _id: id }, { $set: { "file.storedName": "../../../../etc/passwd" } });
  const evil = await fetch(`${app.url}/submissions/${id}/file`, { headers: { Authorization: `Bearer ${await w.tok(w.users.g1)}` } });
  assert.equal(evil.status, 400);
  assert.ok(!(await evil.text()).includes("root:"));
});

/* ------------------------------ upload malware scanning ------------------------------ */
const setScanner = (mode, extra = {}) => Object.assign(env.scanner, { bin: process.execPath, args: [SCANNER, "{file}", mode], timeoutMs: 5000, required: false, ...extra });
const files = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => !f.startsWith(".write-test")) : []);
const submit4 = (name = "r.pdf") => leader.upload("/teams/A-T01/reviews/review-4/submissions", {}, { name, buffer: pdf(String(Math.random())) });
beforeEach(async () => {
  Object.assign(env.scanner, { bin: "", args: ["{file}"], timeoutMs: 30000, required: false });
  await Submission.deleteMany({ team: w.teams.tA1._id, reviewKey: "review-4" });
  fs.rmSync(path.join(env.uploadDir, ".quarantine"), { recursive: true, force: true });
});

test("scanner: an infected file is rejected (422), quarantined, never stored, and leaves no temp file", async () => {
  setScanner("infected");
  const before = (await Submission.countDocuments({ reviewKey: "review-4" }));
  const teamDir = path.join(env.uploadDir, String(w.teams.tA1._id));
  const storedBefore = files(teamDir).length;
  const warn = []; const orig = console.warn; console.warn = (...a) => warn.push(a.join(" "));
  const r = await submit4("virus.pdf");
  console.warn = orig;
  assert.equal(r.status, 422);
  assert.match(r.body.error, /security scan/);
  assert.equal(await Submission.countDocuments({ reviewKey: "review-4" }), before, "no submission created");
  const q = files(path.join(env.uploadDir, ".quarantine"));
  assert.equal(q.length, 1, "file moved to quarantine");
  assert.ok(!q[0].includes("."), "quarantined under a random name without an extension");
  assert.deepEqual(files(path.join(env.uploadDir, ".tmp")), [], "no leftover temp file");
  assert.equal(files(teamDir).length, storedBefore, "nothing was stored in the team's folder");
  assert.match(warn.join("\n"), /quarantined as/);
  assert.ok(!warn.join("\n").includes(env.uploadDir), "log does not reveal server paths");
});

test("scanner: a clean file is accepted and the {file} placeholder is substituted with a real path", async () => {
  setScanner("clean");
  const r = await submit4();
  assert.equal(r.status, 201);
  assert.deepEqual(files(path.join(env.uploadDir, ".quarantine")), []);
});

test("scanner failure (error exit, timeout, missing binary): optional mode allows with a log; required mode fails closed with 503", async () => {
  const cases = [["error exit", () => setScanner("error")], ["timeout", () => setScanner("hang", { timeoutMs: 300 })], ["missing binary", () => Object.assign(env.scanner, { bin: "/definitely/not/installed", args: ["{file}"], required: false })]];
  for (const [label, configure] of cases) {
    configure();
    const errs = []; const orig = console.error; console.error = (...a) => errs.push(a.join(" "));
    const open = await submit4();
    console.error = orig;
    assert.equal(open.status, 201, `${label}: optional → accepted`);
    assert.match(errs.join("\n"), /scanner error/i, `${label}: logged`);
    await Submission.deleteMany({ team: w.teams.tA1._id, reviewKey: "review-4" });
    env.scanner.required = true;
    const t0 = Date.now();
    const closed = await submit4();
    assert.equal(closed.status, 503, `${label}: required → rejected`);
    assert.equal(await Submission.countDocuments({ team: w.teams.tA1._id, reviewKey: "review-4" }), 0);
    assert.deepEqual(files(path.join(env.uploadDir, ".tmp")), [], `${label}: temp file removed`);
    if (label === "timeout") assert.ok(Date.now() - t0 < 4000, "hung scanner is cut off by the timeout");
  }
});

test("scanner runs only after cheap validation (a wrong file type never reaches the scanner)", async () => {
  setScanner("infected");
  const r = await leader.upload("/teams/A-T01/reviews/review-4/submissions", {}, { name: "x.exe", buffer: pdf() });
  assert.equal(r.status, 400);
  assert.deepEqual(files(path.join(env.uploadDir, ".quarantine")), [], "nothing quarantined: it was refused before scanning");
});

/* ------------------------------ configuration ------------------------------ */
test("assertEnv rejects invalid scanner arguments and disabled rate limiting in production", () => {
  const good = { ...env, isProd: true, jwtSecret: "x".repeat(40), otp: { ...env.otp, devFixed: "" }, mail: { user: "a@b.c", pass: "p" }, rateLimit: { ...env.rateLimit, enabled: true }, scanner: { ...env.scanner, bin: "", args: ["{file}"] } };
  assert.doesNotThrow(() => assertEnv(good));
  assert.throws(() => assertEnv({ ...good, scanner: { ...good.scanner, bin: "/usr/bin/clamdscan", args: null } }), /UPLOAD_SCANNER_ARGS/);
  assert.throws(() => assertEnv({ ...good, rateLimit: { ...good.rateLimit, enabled: false } }), /RATE_LIMIT_ENABLED/);
  assert.doesNotThrow(() => assertEnv({ ...good, isProd: false, rateLimit: { ...good.rateLimit, enabled: false } }));
});

/* ------------------------------ deployment verification script ------------------------------ */
function runVerify(mongoUri, extraEnv = {}) {
  const r = spawnSync(process.execPath, [path.join(here, "..", "scripts", "verify-deployment.js")], {
    env: { PATH: process.env.PATH, NODE_ENV: "development", JWT_SECRET: process.env.JWT_SECRET, MONGO_URI: mongoUri, UPLOAD_DIR: env.uploadDir, ...extraEnv }, encoding: "utf8", timeout: 60000,
  });
  return { code: r.status, out: r.stdout + r.stderr };
}
test("verify-deployment: passes against a healthy database and is read-only", async () => {
  const before = await (await import("mongoose")).default.connection.db.collection("users").countDocuments();
  const r = runVerify("mongodb://127.0.0.1:27018/reviewslot_test_hardening?directConnection=true");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /PASS\s+connected to MongoDB/);
  assert.match(r.out, /PASS\s+index bookingrequests \{"slot":1\} \(unique\)/);
  assert.match(r.out, /PASS\s+seat and guide-workload counters match/);
  assert.match(r.out, /WARN\s+email is not configured/, "dev: mail missing is a warning");
  assert.equal(await (await import("mongoose")).default.connection.db.collection("users").countDocuments(), before, "no data changed");
});

test("verify-deployment: fails when the safety indexes are missing, and warns when counters drifted", async () => {
  const emptyUri = "mongodb://127.0.0.1:27018/reviewslot_test_verify_empty?directConnection=true";
  const setup = await (await import("mongoose")).default.createConnection(emptyUri).asPromise();
  await setup.dropDatabase(); // precondition: a database that has never been touched by the API
  await setup.close();
  const bad = runVerify(emptyUri);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /FAIL\s+index bookingrequests/);
  assert.match(bad.out, /missing: start the API once/);
  const mongoose = (await import("mongoose")).default;
  const probe = await mongoose.createConnection("mongodb://127.0.0.1:27018/reviewslot_test_verify_empty?directConnection=true").asPromise();
  await new Promise((r) => setTimeout(r, 500));
  assert.deepEqual(await probe.db.listCollections().toArray(), [], "the check created nothing (no collections, no indexes)");
  await probe.close();
  const Section = (await import("../src/models/Section.js")).default;
  await Section.updateOne({ _id: w.A._id }, { $set: { studentCount: 77 } });
  const drift = runVerify("mongodb://127.0.0.1:27018/reviewslot_test_hardening?directConnection=true");
  assert.equal(drift.code, 0, "drift is a warning, not a failure");
  assert.match(drift.out, /WARN\s+1 seat\/workload counter\(s\) differ/);
  const prod = runVerify("mongodb://127.0.0.1:27018/reviewslot_test_hardening?directConnection=true", { NODE_ENV: "production", JWT_SECRET: "short" });
  assert.equal(prod.code, 1);
  assert.match(prod.out, /FAIL\s+configuration/);
  await (await import("../src/shared/counters.js")).reconcileCounters();
});
