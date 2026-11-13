import nodemailer from "nodemailer";
import { env } from "../config/env.js";

/** Test hook: in NODE_ENV=test messages are captured here instead of being sent. */
export const outbox = [];
let transporter;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const mailConfigured = () => Boolean(env.mail.user && env.mail.pass);

/** Test-only switches (honoured only when NODE_ENV=test): simulate unconfigured SMTP or per-recipient / total rejection. */
export const mailTest = { configured: true, failAll: false, failFor: new Set(), delayMs: 0 };
export const mailAvailable = () => (env.isTest ? mailTest.configured : mailConfigured());

function getTransporter() {
  if (!transporter) transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: env.mail.user, pass: env.mail.pass },
    // fail fast instead of hanging a request for minutes when SMTP is unreachable
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
  return transporter;
}

export class MailNotConfiguredError extends Error {
  constructor() {
    super("Email delivery is not configured (GMAIL_USER / GMAIL_APP_PASSWORD)");
    this.name = "MailNotConfiguredError";
  }
}

/** Resolves true only when the message was accepted for delivery; every other outcome throws (callers must handle it). */
export async function sendMail({ to, subject, text, html }) {
  if (!mailAvailable()) throw new MailNotConfiguredError();
  if (env.isTest) {
    if (mailTest.delayMs) await new Promise((r) => setTimeout(r, mailTest.delayMs));
    if (mailTest.failAll || mailTest.failFor.has(to)) throw new Error("550 SMTP rejected the message (simulated)");
    outbox.push({ to, subject, text, html });
    return true;
  }
  await getTransporter().sendMail({ from: `"${env.mail.fromName}" <${env.mail.user}>`, to, subject, text, html });
  return true;
}

const layout = (title, bodyHtml) => `<!doctype html><html><body style="margin:0;background:#eef0ee;font-family:Segoe UI,Arial,sans-serif;color:#26302e">
<div style="max-width:520px;margin:32px auto;background:#f6f7f5;border-radius:20px;padding:32px;border:1px solid #dde1dd">
<h2 style="margin:0 0 16px;font-size:18px;color:#34506b">${esc(title)}</h2>${bodyHtml}
<p style="margin-top:28px;font-size:12px;color:#6b7774">This is an automated message from the ${esc(env.mail.fromName)}.</p></div></body></html>`;

export function sendOtpEmail(user, code) {
  const minutes = env.otp.expiryMinutes;
  return sendMail({
    to: user.email,
    subject: "Your sign-in code",
    text: `Hello ${user.name}, your sign-in code is ${code}. It expires in ${minutes} minutes. If you did not request it, ignore this email.`,
    html: layout("Your sign-in code", `<p>Hello ${esc(user.name)},</p><p style="font-size:32px;letter-spacing:8px;font-weight:600;margin:20px 0">${esc(code)}</p><p>This code expires in ${minutes} minutes. If you did not request it, you can ignore this email.</p>`),
  });
}

/** Generic transactional message used for booking events. */
export function sendNotificationEmail(user, subject, lines) {
  return sendMail({
    to: user.email,
    subject,
    text: `Hello ${user.name},\n\n${lines.join("\n")}`,
    html: layout(subject, `<p>Hello ${esc(user.name)},</p>${lines.map((l) => `<p>${esc(l)}</p>`).join("")}`),
  });
}
