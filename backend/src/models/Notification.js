import mongoose from "mongoose";

const { Schema } = mongoose;

const notificationSchema = new Schema(
  {
    recipient: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, required: true, maxlength: 60 },
    title: { type: String, required: true, maxlength: 160 },
    message: { type: String, required: true, maxlength: 600 },
    link: { type: String, maxlength: 200 },
    isRead: { type: Boolean, default: false },
    readAt: Date,
    /** Optional idempotency key: the same (recipient, dedupeKey) can only be created once, so retried operations never duplicate. */
    dedupeKey: { type: String, maxlength: 120 },
    /** Delivery record for the *email copy* of this notification (the in-app notification always exists regardless). */
    email: {
      status: { type: String, enum: ["not_requested", "pending", "sent", "failed", "skipped"], default: "not_requested" },
      attempts: { type: Number, default: 0 },
      lastAttemptAt: Date,
      lastError: { type: String, maxlength: 200 },
    },
  },
  { timestamps: true }
);

notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, isRead: 1 });
notificationSchema.index({ recipient: 1, dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } });
notificationSchema.index({ "email.status": 1, "email.lastAttemptAt": 1 });
// In-app notifications are transient; they expire after 90 days (records of record live in AuditLog / submissions).
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

export default mongoose.model("Notification", notificationSchema);
