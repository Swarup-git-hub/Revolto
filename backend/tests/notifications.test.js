import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildWorld, futureDate, startApp } from "./helpers.js";
import { mailTest, outbox } from "../src/shared/mail.js";
import { MAX_EMAIL_ATTEMPTS, drainNotifications, notify, retryFailedEmails } from "../src/shared/notify.js";
import Notification from "../src/models/Notification.js";
import BookingSlot from "../src/models/BookingSlot.js";
import User from "../src/models/User.js";

let app, w, ids;
before(async () => {
  app = await startApp("notifications");
  w = await buildWorld(app.url);
  ids = w.users.st.map((s) => s._id);
});
after(() => app.stop());
beforeEach(async () => {
  mailTest.configured = true; mailTest.failAll = false; mailTest.failFor.clear(); mailTest.delayMs = 0;
  outbox.length = 0;
  await Notification.deleteMany({});
});

const payload = (over = {}) => ({ type: "t", title: "Subject line", message: "Secret body text", link: "/x", ...over });
const rec = (user) => Notification.findOne({ recipient: user._id }).lean();
async function captureWarnings(fn) {
  const lines = [];
  const orig = console.warn;
  console.warn = (...a) => lines.push(a.join(" "));
  try { await fn(); } finally { console.warn = orig; }
  return lines.join("\n");
}

test("successful delivery: in-app record plus a tracked email per recipient", async () => {
  await notify([ids[0], ids[1]], payload(), { email: true });
  await drainNotifications();
  assert.equal(outbox.length, 2);
  for (const u of [w.users.st[0], w.users.st[1]]) {
    const n = await rec(u);
    assert.equal(n.email.status, "sent");
    assert.equal(n.email.attempts, 1);
    assert.equal(n.email.lastError, null);
  }
});

test("partial failure: failed recipient is recorded and logged safely; others and all in-app records are unaffected", async () => {
  mailTest.failFor.add("s2@t.edu");
  const logs = await captureWarnings(async () => {
    await notify([ids[0], ids[1], ids[2]], payload(), { email: true });
    await drainNotifications();
  });
  assert.equal(outbox.length, 2, "two emails went out");
  assert.equal((await rec(w.users.st[0])).email.status, "sent");
  const failed = await rec(w.users.st[1]);
  assert.equal(failed.email.status, "failed");
  assert.equal(failed.email.attempts, 1);
  assert.match(failed.email.lastError, /SMTP rejected/);
  assert.equal((await rec(w.users.st[2])).email.status, "sent");
  assert.equal(await Notification.countDocuments(), 3, "every in-app notification exists");
  assert.match(logs, /Notification email failed/);
  assert.ok(!logs.includes("s2@t.edu") && !logs.includes("Secret body text") && !logs.includes("Subject line"), "no address or content in logs");
});

test("complete email failure: in-app notifications remain available through the API", async () => {
  mailTest.failAll = true;
  await captureWarnings(async () => { await notify([ids[0]], payload({ title: "Hello", message: "World" }), { email: true }); await drainNotifications(); });
  assert.equal((await rec(w.users.st[0])).email.status, "failed");
  const list = await (await w.api(w.users.st[0])).get("/notifications");
  assert.equal(list.status, 200);
  assert.equal(list.body.notifications.length, 1);
  assert.equal(list.body.notifications[0].title, "Hello");
  assert.equal(list.body.unread, 1);
});

test("booking approval does not depend on email: succeeds instantly even if SMTP is down or very slow", async () => {
  const g1 = await w.api(w.users.g1);
  const s1 = await w.api(w.users.st[0]);
  await g1.post("/bookings/slots", { mode: "manual", reviewKey: "review-2", date: futureDate(4), start: "09:00", end: "09:30" });
  const slot = await BookingSlot.findOne({ date: futureDate(4) });
  mailTest.failAll = true; mailTest.delayMs = 1500;
  const t0 = Date.now();
  const req = await s1.post("/bookings/requests", { slotId: String(slot._id) });
  assert.equal(req.status, 201);
  const approve = await g1.post(`/bookings/requests/${req.body.request.id}/approve`);
  const elapsed = Date.now() - t0;
  assert.equal(approve.status, 200);
  assert.equal(approve.body.request.status, "approved");
  assert.ok(elapsed < 1200, `responses must not wait for SMTP (took ${elapsed} ms)`);
  await captureWarnings(drainNotifications);
  const mine = await Notification.find({ recipient: w.users.st[0]._id, type: "booking_approve" }).lean();
  assert.equal(mine.length, 1, "approval notification exists in-app");
  assert.equal(mine[0].email.status, "failed");
});

test("retry re-sends the SAME records, never creates new ones, and is idempotent", async () => {
  mailTest.failAll = true;
  await captureWarnings(async () => { await notify([ids[0], ids[1]], payload(), { email: true }); await drainNotifications(); });
  const before = (await Notification.find().lean()).map((n) => String(n._id)).sort();
  mailTest.failAll = false;
  const first = await retryFailedEmails();
  assert.deepEqual([first.attempted, first.sent, first.failed], [2, 2, 0]);
  assert.equal(outbox.length, 2);
  const after = (await Notification.find().lean());
  assert.deepEqual(after.map((n) => String(n._id)).sort(), before, "no new notification documents");
  assert.ok(after.every((n) => n.email.status === "sent" && n.email.attempts === 2));
  const second = await retryFailedEmails();
  assert.equal(second.attempted, 0, "nothing left to retry");
  assert.equal(outbox.length, 2, "no duplicate emails");
});

test("retry gives up after the maximum number of attempts", async () => {
  mailTest.failAll = true;
  await captureWarnings(async () => {
    await notify([ids[0]], payload(), { email: true });
    await drainNotifications();
    for (let i = 0; i < 5; i++) await retryFailedEmails();
  });
  const n = await rec(w.users.st[0]);
  assert.equal(n.email.attempts, MAX_EMAIL_ATTEMPTS);
  assert.equal(n.email.status, "failed");
});

test("two workers retrying at once send each email exactly once", async () => {
  mailTest.failAll = true;
  await captureWarnings(async () => { await notify(ids.slice(0, 5), payload(), { email: true }); await drainNotifications(); });
  mailTest.failAll = false; mailTest.delayMs = 50;
  const [a, b] = await Promise.all([retryFailedEmails(), retryFailedEmails()]);
  assert.equal(a.attempted + b.attempted, 5);
  assert.equal(outbox.length, 5, "5 notifications → exactly 5 emails");
});

test("dedupeKey prevents duplicate notifications and duplicate emails when an operation is retried", async () => {
  const p = payload({ dedupeKey: "evt:1" });
  const r1 = await notify([ids[0]], p, { email: true });
  const r2 = await notify([ids[0]], p, { email: true });
  await drainNotifications();
  assert.deepEqual([r1.created, r1.duplicates, r2.created, r2.duplicates], [1, 0, 0, 1]);
  assert.equal(await Notification.countDocuments({ recipient: ids[0] }), 1);
  assert.equal(outbox.length, 1);
  // mixed: one recipient already has the key, another does not
  const r3 = await notify([ids[0], ids[1]], p, { email: true });
  await drainNotifications();
  assert.deepEqual([r3.created, r3.duplicates], [1, 1]);
  assert.equal(outbox.length, 2);
  // a different key is a different event
  assert.equal((await notify([ids[0]], payload({ dedupeKey: "evt:2" }))).created, 1);
});

test("email skipped (not failed) when mail is unconfigured or the recipient is inactive; in-app still created", async () => {
  mailTest.configured = false;
  await notify([ids[0]], payload(), { email: true });
  await drainNotifications();
  assert.equal((await rec(w.users.st[0])).email.status, "skipped");
  mailTest.configured = true;
  await User.updateOne({ _id: ids[1] }, { $set: { isActive: false } });
  await notify([ids[1]], payload(), { email: true });
  await drainNotifications();
  assert.equal((await rec(w.users.st[1])).email.status, "skipped");
  await User.updateOne({ _id: ids[1] }, { $set: { isActive: true } });
  assert.equal(outbox.length, 0);
  assert.equal((await retryFailedEmails()).attempted, 0, "skipped records are not retried");
});

test("without the email option nothing is emailed and the record says so", async () => {
  await notify([ids[0]], payload());
  await drainNotifications();
  assert.equal(outbox.length, 0);
  assert.equal((await rec(w.users.st[0])).email.status, "not_requested");
});
