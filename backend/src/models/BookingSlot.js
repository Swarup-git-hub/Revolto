import mongoose from "mongoose";
import { SLOT_STATUS } from "../shared/constants.js";

const { Schema } = mongoose;

/** A single bookable review slot owned by a Guide. Capacity is one team per slot. */
const bookingSlotSchema = new Schema(
  {
    guide: { type: Schema.Types.ObjectId, ref: "User", required: true },
    /** Teams of this section may book it; null = any section of this guide's teams. */
    section: { type: Schema.Types.ObjectId, ref: "Section", default: null },
    reviewKey: { type: String, required: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    startMin: { type: Number, required: true, min: 0, max: 1439 },
    endMin: { type: Number, required: true, min: 1, max: 1440 },
    status: { type: String, enum: Object.values(SLOT_STATUS), default: SLOT_STATUS.AVAILABLE },
    bookedTeam: { type: Schema.Types.ObjectId, ref: "Team", default: null },
    disabledReason: String,
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

// A guide can never have two slots starting at the same moment (duplicate protection).
bookingSlotSchema.index({ guide: 1, date: 1, startMin: 1 }, { unique: true });
bookingSlotSchema.index({ section: 1, date: 1 });
bookingSlotSchema.index({ status: 1, date: 1 });

export default mongoose.model("BookingSlot", bookingSlotSchema);
