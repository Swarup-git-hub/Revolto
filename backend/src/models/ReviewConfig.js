import mongoose from "mongoose";
import { REVIEW_TYPES } from "../shared/constants.js";

const { Schema } = mongoose;

const fieldSchema = new Schema(
  {
    key: { type: String, required: true, match: /^[a-zA-Z][a-zA-Z0-9_]{0,40}$/ },
    label: { type: String, required: true, maxlength: 120 },
    kind: { type: String, enum: ["text", "longtext", "select"], default: "text" },
    required: { type: Boolean, default: false },
    maxLength: { type: Number, default: 4000 },
    options: [{ _id: false, value: String, label: String }],
    deprecated: { type: Boolean, default: false },
  },
  { _id: false }
);

const reviewConfigSchema = new Schema(
  {
    /** Stable slug used in submissions and bookings, e.g. "review-2". Never changes once created. */
    key: { type: String, required: true, match: /^[a-z][a-z0-9-]{1,40}$/ },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    order: { type: Number, required: true },
    type: { type: String, enum: REVIEW_TYPES, required: true },
    /** null = college-wide (HOD). Otherwise overrides the college-wide review for that section (Coordinator). */
    section: { type: Schema.Types.ObjectId, ref: "Section", default: null },
    deadline: { type: Date, default: null },
    fields: [fieldSchema],
    /** Only for type "progress". */
    milestones: [{ _id: false, key: { type: String, match: /^[a-z][a-z0-9_-]{0,40}$/ }, label: String, deprecated: { type: Boolean, default: false } }],
    individualContributions: { type: Boolean, default: false },
    upload: {
      enabled: { type: Boolean, default: false },
      required: { type: Boolean, default: false },
      acceptedTypes: { type: [String], default: ["pdf"] },
      maxSizeMB: { type: Number, default: 10, min: 1, max: 25 },
    },
    archivedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

reviewConfigSchema.index({ key: 1, section: 1 }, { unique: true, partialFilterExpression: { archivedAt: null } });

export default mongoose.model("ReviewConfig", reviewConfigSchema);
