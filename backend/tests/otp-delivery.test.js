import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildWorld, client, startApp } from "./helpers.js";
import { env, assertEnv } from "../src/config/env.js";
import { mailTest, outbox } from "../src/shared/mail.js";
import User from "../src/models/User.js";

let app, w;
before(async () => { app = await startApp("otpdelivery"); w = await buildWorld(app.url); });
after(() => app.stop());
beforeEach(async () => {
  mailTest.configured = true; mailTest.failAll = false; mailTest.failFor.clear();
  env.otp.devFixed = ""; env.otp.resendCooldownSeconds = 0; env.otp.maxRequestsPerHour = 5;
  await User.updateMany({}, { $unset: { otp: 1 } });
  outbox.length = 0;
});

const send = (email) => client(app.url).post("/auth/send-otp", { email });
const verify = (email, otp) => client(app.url).post("/auth/verify-otp", { email, otp });
const raw = (email) => User.findOne({ email }).select("+otp").lean();
const codeFromMail = () => /(\d{6})/.exec(outbox.at(-1).text)[1];

/** Captures everything written to the console while fn runs. */
async function captureLogs(fn) {
  const lines = [];
  const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  for (const k of Object.keys(orig)) console[k] = (...a) => lines.push(a.map(String).join(" "));
  try { await fn(); } finally { Object.assign(console, orig); }
  return lines.join("\n");
}

test("unconfigured email: request fails with 503 for known AND unknown addresses (no enumeration), nothing stored", async () => {
  mailTest.configured = false;
  const known = await send("s1@t.edu");
  const unknown = await send("nobody@t.edu");
  assert.equal(known.status, 503, "must not claim a code was sent");
  assert.equal(unknown.status, 503, "identical answer for unknown addresses");
  assert.equal(known.body.error, unknown.body.error);
  assert.equal((await raw("s1@t.edu")).otp, undefined, "no unusable OTP state is left behind");
  assert.equal(outbox.length, 0);
});

test("DEV_FIXED_OTP works without any mail setup (development only)", async () => {
  mailTest.configured = false;
  env.otp.devFixed = "123456";
  const r = await send("s1@t.edu");
  assert.equal(r.status, 200);
  assert.equal((await verify("s1@t.edu", "123456")).status, 200);
  assert.equal(outbox.length, 0, "nothing is emailed when a fixed code is used");
});

test("successful delivery: 200, code emailed, hashed at rest, not in the response", async () => {
  const r = await send("s2@t.edu");
  assert.equal(r.status, 200);
  assert.ok(!/\d{6}/.test(JSON.stringify(r.body)));
  assert.equal(outbox.length, 1);
  const code = codeFromMail();
  const o = (await raw("s2@t.edu")).otp;
  assert.notEqual(o.hash, code);
  assert.equal(o.requestsInWindow, 1);
  assert.equal((await verify("s2@t.edu", code)).status, 200);
});

test("SMTP rejection: 503, OTP state fully rolled back, cooldown and hourly budget NOT consumed", async () => {
  env.otp.resendCooldownSeconds = 60;
  mailTest.failAll = true;
  const r = await send("s3@t.edu");
  assert.equal(r.status, 503);
  assert.match(r.body.error, /could not send/i);
  assert.equal((await raw("s3@t.edu")).otp, undefined, "no code nobody received");
  mailTest.failAll = false;
  const retry = await send("s3@t.edu"); // would be 429 if the failed attempt had started the cooldown
  assert.equal(retry.status, 200);
  assert.equal((await raw("s3@t.edu")).otp.requestsInWindow, 1);
});

test("a failed re-send does not invalidate a previously delivered, still-valid code", async () => {
  await send("s4@t.edu");
  const good = codeFromMail();
  mailTest.failFor.add("s4@t.edu");
  assert.equal((await send("s4@t.edu")).status, 503);
  mailTest.failFor.clear();
  assert.equal((await verify("s4@t.edu", good)).status, 200, "the earlier code still works");
});

test("failures cap nothing: repeated SMTP failures never exhaust the hourly request budget", async () => {
  env.otp.maxRequestsPerHour = 2;
  mailTest.failAll = true;
  for (let i = 0; i < 4; i++) assert.equal((await send("s5@t.edu")).status, 503);
  mailTest.failAll = false;
  assert.equal((await send("s5@t.edu")).status, 200);
});

test("OTP values never appear in logs, including during delivery failures", async () => {
  env.otp.devFixed = "";
  const okLogs = await captureLogs(async () => { await send("s6@t.edu"); });
  const code = codeFromMail();
  assert.ok(!okLogs.includes(code));
  mailTest.failAll = true;
  const failLogs = await captureLogs(async () => { await send("s6@t.edu"); });
  assert.ok(!/\b\d{6}\b/.test(failLogs), `logs leaked a 6-digit value: ${failLogs}`);
  
});

test("unknown email with working mail still gets the generic 200", async () => {
  const a = await send("nobody@t.edu");
  const b = await send("s7@t.edu");
  assert.equal(a.status, 200);
  assert.equal(a.body.message, b.body.message);
  assert.equal(outbox.length, 1, "only the real account is emailed");
});

test("production configuration validation (assertEnv)", () => {
  const good = { ...env, isProd: true, jwtSecret: "x".repeat(40), otp: { ...env.otp, devFixed: "" }, mail: { user: "a@b.c", pass: "app-password" }, rateLimit: { ...env.rateLimit, enabled: true } };
  assert.doesNotThrow(() => assertEnv(good));
  assert.throws(() => assertEnv({ ...good, mail: { user: "", pass: "" } }), /GMAIL_USER/);
  assert.throws(() => assertEnv({ ...good, mail: { user: "a@b.c", pass: "" } }), /GMAIL_APP_PASSWORD/);
  assert.throws(() => assertEnv({ ...good, otp: { ...good.otp, devFixed: "123456" } }), /DEV_FIXED_OTP/);
  assert.throws(() => assertEnv({ ...good, jwtSecret: "short" }), /JWT_SECRET/);
  // development: mail is optional (a warning is shown at boot instead)
  assert.doesNotThrow(() => assertEnv({ ...good, isProd: false, mail: { user: "", pass: "" } }));
});
