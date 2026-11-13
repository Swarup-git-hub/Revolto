import Notification from "../models/Notification.js";
import User from "../models/User.js";
import { mailAvailable, sendNotificationEmail } from "./mail.js";
import { emitToUsers } from "./socket.js";

export const MAX_EMAIL_ATTEMPTS = 3;
const STUCK_PENDING_MS = 15 * 60 * 1000;

/* Emails are sent in the background so a slow or failing SMTP server can never delay or break the
   operation that triggered the notification (e.g. approving a booking). Tests await `drainNotifications()`. */
const inFlight = new Set();
function track(promise) {
  inFlight.add(promise);
  promise.finally(() => inFlight.delete(promise));
  return promise;
}
export async function drainNotifications() {
  while (inFlight.size) await Promise.allSettled([...inFlight]);
}

const setEmail = (id, patch, inc = 0) =>
  Notification.updateOne({ _id: id }, { $set: Object.fromEntries(Object.entries(patch).map(([k, v]) => [`email.${k}`, v])), ...(inc ? { $inc: { "email.attempts": inc } } : {}) });

/** Sends the email copy for already-stored notifications and records the outcome on each one. Never throws. */
async function deliverEmails(notifications) {
  try {
    const users = await User.find({ _id: { $in: notifications.map((n) => n.recipient) } }, "name email isActive").lean();
    const byId = new Map(users.map((u) => [String(u._id), u]));
    await Promise.all(
      notifications.map(async (n) => {
        const now = new Date();
        const user = byId.get(String(n.recipient));
        try {
          if (!user || !user.isActive) return await setEmail(n._id, { status: "skipped", lastAttemptAt: now, lastError: "recipient is missing or inactive" });
          if (!mailAvailable()) return await setEmail(n._id, { status: "skipped", lastAttemptAt: now, lastError: "email delivery is not configured" });
          await sendNotificationEmail(user, n.title, [n.message]);
          await setEmail(n._id, { status: "sent", lastAttemptAt: now, lastError: null }, 1);
        } catch (err) {
          // Log identifiers and the error only: no address, subject or message body.
          const attempt = (n.email?.attempts || 0) + 1;
          console.warn(`Notification email failed (notification ${n._id}, recipient ${n.recipient}, attempt ${attempt}): ${String(err.message).slice(0, 160)}`);
          await setEmail(n._id, { status: "failed", lastAttemptAt: now, lastError: String(err.message).slice(0, 200) }, 1).catch(() => {});
        }
      })
    );
  } catch (err) {
    console.error("Notification email batch failed:", err.message);
  }
}

/**
 * Creates in-app notifications (always) and, when `email` is true, queues an email copy per recipient.
 * `dedupeKey` makes the call idempotent per recipient. Returns once the in-app records exist; never throws.
 */
export async function notify(recipientIds, { type, title, message, link, dedupeKey }, { email = false } = {}) {
  const ids = [...new Set(recipientIds.filter(Boolean).map(String))];
  const result = { created: 0, duplicates: 0 };
  if (!ids.length) return result;
  const base = { type, title, message, link, ...(dedupeKey ? { dedupeKey } : {}), email: { status: email ? "pending" : "not_requested", ...(email ? { lastAttemptAt: new Date() } : {}) } };
  const created = [];
  try {
    if (dedupeKey) {
      for (const recipient of ids) {
        try {
          created.push((await Notification.create({ ...base, recipient })).toObject());
        } catch (err) {
          if (err?.code === 11000) result.duplicates++;
          else throw err;
        }
      }
    } else {
      created.push(...(await Notification.insertMany(ids.map((recipient) => ({ ...base, recipient })))).map((d) => d.toObject()));
    }
    result.created = created.length;
    emitToUsers(created.map((n) => n.recipient), "notification", { type });
    if (email && created.length) track(deliverEmails(created));
  } catch (err) {
    console.error("Notification creation failed:", err.message);
  }
  return result;
}

/**
 * Re-sends email copies that failed (or got stuck as "pending") for existing notifications.
 * It only updates the delivery record: it never creates notifications, so nothing is duplicated.
 * Claiming is atomic, so two workers never send the same email twice.
 */
export async function retryFailedEmails({ limit = 100, maxAttempts = MAX_EMAIL_ATTEMPTS } = {}) {
  const out = { attempted: 0, sent: 0, failed: 0, skipped: 0 };
  const stuckBefore = new Date(Date.now() - STUCK_PENDING_MS);
  for (let i = 0; i < limit; i++) {
    const claimed = await Notification.findOneAndUpdate(
      { "email.attempts": { $lt: maxAttempts }, $or: [{ "email.status": "failed" }, { "email.status": "pending", "email.lastAttemptAt": { $lt: stuckBefore } }] },
      { $set: { "email.status": "pending", "email.lastAttemptAt": new Date() } },
      { new: true, sort: { "email.lastAttemptAt": 1 } }
    ).lean();
    if (!claimed) break;
    out.attempted++;
    await deliverEmails([claimed]);
    const after = await Notification.findById(claimed._id, "email.status").lean();
    out[{ sent: "sent", failed: "failed", skipped: "skipped" }[after?.email?.status] || "failed"]++;
  }
  return out;
}
