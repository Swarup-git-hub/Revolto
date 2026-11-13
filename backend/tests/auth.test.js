import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { buildWorld, client, startApp } from "./helpers.js";
import { outbox } from "../src/shared/mail.js";
import User from "../src/models/User.js";

let app, w;
before(async () => { app = await startApp("auth"); w = await buildWorld(app.url); });
after(() => app.stop());

const lastCode = () => /(\d{6})/.exec(outbox.at(-1).text)[1];
const send = (email) => client(app.url).post("/auth/send-otp", { email });
const verify = (email, otp) => client(app.url).post("/auth/verify-otp", { email, otp });

test("OTP login: code is 6 digits, hashed at rest, never returned to the client", async () => {
  const r = await send("s1@t.edu");
  assert.equal(r.status, 200);
  assert.ok(!JSON.stringify(r.body).match(/\d{6}/), "response must not contain a code");
  const code = lastCode();
  assert.match(code, /^\d{6}$/);
  const raw = await User.findOne({ email: "s1@t.edu" }).select("+otp").lean();
  assert.ok(raw.otp.hash && raw.otp.hash !== code, "stored value must be a hash");
  assert.ok(raw.otp.expiresAt.getTime() - Date.now() <= 5 * 60 * 1000 + 2000, "expires within 5 minutes");
  const v = await verify("s1@t.edu", code);
  assert.equal(v.status, 200);
  assert.ok(v.body.token);
  assert.equal(v.body.user.role, "student");
  assert.equal((await verify("s1@t.edu", code)).status, 400, "a code works only once");
});

test("unknown email gets the same generic answer (no account enumeration)", async () => {
  const a = await send("nobody@t.edu");
  const b = await send("s2@t.edu");
  assert.equal(a.status, 200);
  assert.equal(a.body.message, b.body.message);
});

test("verification is locked after the configured number of wrong attempts", async () => {
  await send("s3@t.edu");
  const code = lastCode();
  const wrong = code === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++) assert.equal((await verify("s3@t.edu", wrong)).status, 400);
  assert.equal((await verify("s3@t.edu", wrong)).status, 429);
  assert.equal((await verify("s3@t.edu", code)).status, 400, "even the right code is refused after lock-out; a new code is needed");
  await send("s3@t.edu");
  assert.equal((await verify("s3@t.edu", lastCode())).status, 200);
});

test("code requests are capped per hour", async () => {
  for (let i = 0; i < 5; i++) assert.equal((await send("s4@t.edu")).status, 200);
  assert.equal((await send("s4@t.edu")).status, 429);
});

test("expired code is rejected", async () => {
  await send("s5@t.edu");
  const code = lastCode();
  await User.updateOne({ email: "s5@t.edu" }, { $set: { "otp.expiresAt": new Date(Date.now() - 1000) } });
  assert.equal((await verify("s5@t.edu", code)).status, 400);
});

test("protected routes need a valid token; deactivated users and signed-out tokens stop working", async () => {
  assert.equal((await client(app.url).get("/teams")).status, 401);
  assert.equal((await client(app.url, "garbage").get("/teams")).status, 401);
  const stu = await w.api(w.users.st[5]);
  assert.equal((await stu.get("/auth/me")).status, 200);
  await stu.post("/auth/logout");
  assert.equal((await stu.get("/auth/me")).status, 401, "token revoked on logout");
  await User.updateOne({ _id: w.users.st[6]._id }, { $set: { isActive: false } });
  assert.equal((await (await w.api(w.users.st[6])).get("/auth/me")).status, 401);
});

test("role boundaries: each role is refused on endpoints above its authority", async () => {
  const student = await w.api(w.users.st[0]);
  const guide = await w.api(w.users.g1);
  const coord = await w.api(w.users.coordA);
  assert.equal((await student.get("/users")).status, 403);
  assert.equal((await student.patch("/settings", { team: { maxSize: 9 } })).status, 403);
  assert.equal((await guide.get("/audit")).status, 403);
  assert.equal((await coord.patch("/settings", { team: { maxSize: 9 } })).status, 403);
  assert.equal((await coord.get("/audit")).status, 403);
  assert.equal((await guide.post("/sections", { name: "Z" })).status, 403);
});

test("former public endpoints no longer exist or require authentication", async () => {
  const anon = client(app.url);
  for (const p of ["/config", "/slots/session/000000000000000000000000", "/requests/000000000000000000000000", "/teams/000000000000000000000000", "/auth/initialize-admin"]) {
    const r = await anon.get(p);
    assert.ok([401, 404].includes(r.status), `${p} -> ${r.status}`);
    assert.ok(!r.text.includes("session") || r.status === 404);
  }
});

test("error responses never leak stack traces", async () => {
  const hod = await w.api(w.users.hod);
  const r = await hod.get("/teams/not-a-real-team");
  assert.equal(r.status, 404);
  assert.ok(!/at .*\.js/.test(r.text));
});
