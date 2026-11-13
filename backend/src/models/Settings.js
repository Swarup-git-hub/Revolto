import mongoose from "mongoose";

const { Schema } = mongoose;

/** Single college-wide configuration document (key: "default"). Replaces the old `Config` model. */
const settingsSchema = new Schema(
  {
    key: { type: String, default: "default", unique: true },
    college: {
      name: { type: String, default: "" },
      /** Minutes east of UTC used to interpret slot dates/times. Default: IST (+05:30). */
      timezoneOffsetMinutes: { type: Number, default: 330 },
    },
    team: {
      minSize: { type: Number, default: 1, min: 1 },
      maxSize: { type: Number, default: 4, min: 1 },
    },
    section: { defaultCapacity: { type: Number, default: null, min: 1 } },
    guide: { maxTeams: { type: Number, default: 4, min: 1 } },
    reviews: {
      /** After a guide edits an already confirmed title it returns to "submitted" until confirmed again. */
      requireTitleReconfirmation: { type: Boolean, default: true },
    },
    uploads: {
      defaultAcceptedTypes: { type: [String], default: ["pdf"] },
      defaultMaxSizeMB: { type: Number, default: 10, min: 1, max: 25 },
    },
    booking: {
      enabled: { type: Boolean, default: true },
      requestBy: { type: String, enum: ["any_member", "leader"], default: "any_member" },
      minDurationMinutes: { type: Number, default: 15, min: 5 },
      maxDurationMinutes: { type: Number, default: 180, min: 5 },
      /** Requests are refused this many hours before a slot starts. 0 = until the slot starts. */
      cutoffHoursBeforeSlot: { type: Number, default: 0, min: 0 },
      allowGuideSlotCreation: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

export default mongoose.model("Settings", settingsSchema);
