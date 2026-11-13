import mongoose from "mongoose";
import { BOOKING_STATUS } from "../shared/constants.js";

const { Schema } = mongoose;

const bookingRequestSchema = new Schema(
  {
    slot: { type: Schema.Types.ObjectId, ref: "BookingSlot", required: true },
    team: { type: Schema.Types.ObjectId, ref: "Team", required: true },
    section: { type: Schema.Types.ObjectId, ref: "Section", required: true },
    guide: { type: Schema.Types.ObjectId, ref: "User", required: true },
    reviewKey: { type: String, required: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: Object.values(BOOKING_STATUS), default: BOOKING_STATUS.PENDING },
    /** true while status is pending or approved. The partial unique indexes below rely on it. */
    active: { type: Boolean, default: true },
    decidedBy: { type: Schema.Types.ObjectId, ref: "User" },
    decidedAt: Date,
    decisionReason: String,
    overridden: { type: Boolean, default: false },
    history: [
      new Schema(
        { _id: false, action: String, by: { type: Schema.Types.ObjectId, ref: "User" }, byName: String, reason: String, at: { type: Date, default: Date.now }, fromSlot: Schema.Types.ObjectId, toSlot: Schema.Types.ObjectId },
        { _id: false }
      ),
    ],
  },
  { timestamps: true }
);

// Database-level guarantees (independent of any application check):
//  - a slot has at most one live (pending/approved) request  -> no double booking
//  - a team has at most one live request per review session  -> one slot per review
bookingRequestSchema.index({ slot: 1 }, { unique: true, partialFilterExpression: { active: true } });
bookingRequestSchema.index({ team: 1, reviewKey: 1 }, { unique: true, partialFilterExpression: { active: true } });
bookingRequestSchema.index({ guide: 1, status: 1 });
bookingRequestSchema.index({ section: 1, status: 1 });

export default mongoose.model("BookingRequest", bookingRequestSchema);
