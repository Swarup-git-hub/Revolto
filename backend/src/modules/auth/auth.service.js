import crypto from "node:crypto";
import User from "../../models/User.js";
import { env } from "../../config/env.js";
import { signToken } from "../../shared/auth.js";
import { badRequest, tooMany, AppError } from "../../shared/errors.js";
import { mailAvailable, sendOtpEmail } from "../../shared/mail.js";

const GENERIC = "If this email is registered, a sign-in code has been sent.";
const hashOtp = (email, code) => crypto.createHmac("sha256", env.jwtSecret).update(`${email}:${code}`).digest("hex");
const safeEqual = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

const DELIVERY_FAILED = "We could not send the email right now. Please try again shortly.";

export async function requestOtp(email) {
  const result = { message: GENERIC, retryAfterSeconds: env.otp.resendCooldownSeconds };

  // A fixed development code needs no email. Otherwise, if this server cannot send email at all, say so
  // *before* looking the user up, so the answer is identical for registered and unknown addresses.
  const needsMail = !env.otp.devFixed;
  if (needsMail && !mailAvailable()) {
    console.error("OTP requested but email delivery is not configured (GMAIL_USER / GMAIL_APP_PASSWORD).");
    throw new AppError(503, "Email delivery is not available on this server. Please contact the administrator.");
  }

  const user = await User.findOne({ email, isActive: true }).select("+otp");
  if (!user) return result; // do not reveal whether the address is registered

  const now = Date.now();
  const o = user.otp || {};
  const sinceLast = o.lastSentAt ? now - o.lastSentAt.getTime() : Infinity;
  if (sinceLast < env.otp.resendCooldownSeconds * 1000) {
    throw tooMany(`Please wait ${Math.ceil((env.otp.resendCooldownSeconds * 1000 - sinceLast) / 1000)} seconds before requesting another code.`);
  }
  const windowExpired = !o.windowStart || now - o.windowStart.getTime() > 3600 * 1000;
  const requestsInWindow = windowExpired ? 0 : o.requestsInWindow || 0;
  if (requestsInWindow >= env.otp.maxRequestsPerHour) throw tooMany("Too many code requests. Please try again in an hour.");

  const code = env.otp.devFixed || String(crypto.randomInt(100000, 1000000));
  const previous = user.toObject().otp; // snapshot so a failed delivery can be undone exactly
  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        otp: {
          hash: hashOtp(user.email, code),
          expiresAt: new Date(now + env.otp.expiryMinutes * 60000),
          verifyAttempts: 0,
          lastSentAt: new Date(now),
          windowStart: windowExpired ? new Date(now) : o.windowStart,
          requestsInWindow: requestsInWindow + 1,
        },
      },
    }
  );

  if (needsMail) {
    try {
      await sendOtpEmail(user, code);
    } catch (err) {
      // Nothing reached the user: restore the previous state so no unusable code exists and no cooldown/budget is consumed.
      await User.updateOne({ _id: user._id }, previous ? { $set: { otp: previous } } : { $unset: { otp: 1 } });
      console.error(`OTP email delivery failed for user ${user._id}: ${err.message}`); // never log the code
      throw new AppError(503, DELIVERY_FAILED);
    }
  }
  return result;
}

export async function verifyOtp(email, code) {
  const invalid = () => badRequest("That code is incorrect or has expired.");
  const user = await User.findOne({ email, isActive: true }).select("+otp");
  if (!user?.otp?.hash) throw invalid();
  if (!user.otp.expiresAt || user.otp.expiresAt.getTime() < Date.now()) {
    await User.updateOne({ _id: user._id }, { $unset: { otp: 1 } });
    throw invalid();
  }
  // Reserve an attempt atomically first so parallel guesses cannot exceed the limit.
  const reserved = await User.findOneAndUpdate(
    { _id: user._id, "otp.verifyAttempts": { $lt: env.otp.maxVerifyAttempts } },
    { $inc: { "otp.verifyAttempts": 1 } },
    { new: true }
  );
  if (!reserved) {
    await User.updateOne({ _id: user._id }, { $unset: { otp: 1 } });
    throw tooMany("Too many incorrect attempts. Please request a new code.");
  }
  if (!safeEqual(hashOtp(user.email, code), user.otp.hash)) throw invalid();

  await User.updateOne({ _id: user._id }, { $unset: { otp: 1 } });
  return { token: signToken(user), user: await profile(user._id) };
}

export async function logout(userId) {
  await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
}

export async function profile(userId) {
  const u = await User.findById(userId).populate("section", "name").populate("sections", "name").populate({ path: "team", select: "teamId projectTitle titleStatus status section guide leader" }).lean();
  if (!u) return null;
  return {
    id: String(u._id),
    name: u.name,
    email: u.email,
    role: u.role,
    rollNumber: u.rollNumber || null,
    phone: u.phone || null,
    section: u.section ? { id: String(u.section._id), name: u.section.name } : null,
    sections: (u.sections || []).map((s) => ({ id: String(s._id), name: s.name })),
    team: u.team
      ? { id: String(u.team._id), teamId: u.team.teamId, projectTitle: u.team.projectTitle, titleStatus: u.team.titleStatus, status: u.team.status, isLeader: String(u.team.leader) === String(u._id) }
      : null,
  };
}
