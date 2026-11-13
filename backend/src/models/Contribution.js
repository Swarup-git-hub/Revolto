import mongoose from "mongoose";
import { CONTRIBUTION_STATUS } from "../shared/constants.js";

const { Schema } = mongoose;

/** A student's self-reported contribution for a review. Self-reports are never "verified" unless the Guide acknowledges them. */
const contributionSchema = new Schema(
  {
    team: { type: Schema.Types.ObjectId, ref: "Team", required: true },
    section: { type: Schema.Types.ObjectId, ref: "Section", required: true },
    reviewKey: { type: String, required: true },
    student: { type: Schema.Types.ObjectId, ref: "User", required: true },
    studentName: String,
    version: { type: Number, required: true },
    isLatest: { type: Boolean, default: true },
    status: { type: String, enum: Object.values(CONTRIBUTION_STATUS), default: CONTRIBUTION_STATUS.PENDING },
    submittedAt: { type: Date, default: Date.now },
    data: { type: Schema.Types.Mixed, default: {} },
    reviewHistory: [
      new Schema(
        {
          decision: { type: String, enum: ["acknowledged", "changes_required"] },
          feedback: String,
          by: { type: Schema.Types.ObjectId, ref: "User" },
          byName: String,
          at: { type: Date, default: Date.now },
        },
        { _id: false }
      ),
    ],
  },
  { timestamps: true }
);

contributionSchema.index({ team: 1, reviewKey: 1, student: 1, version: 1 }, { unique: true });
contributionSchema.index({ team: 1, reviewKey: 1, student: 1, isLatest: 1 });

export default mongoose.model("Contribution", contributionSchema);
