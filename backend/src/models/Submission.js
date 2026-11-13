import mongoose from "mongoose";
import { SUBMISSION_STATUS } from "../shared/constants.js";

const { Schema } = mongoose;

const reviewEntry = new Schema(
  {
    decision: { type: String, enum: ["under_review", "approved", "changes_required"], required: true },
    feedback: { type: String, default: "" },
    by: { type: Schema.Types.ObjectId, ref: "User" },
    byName: String,
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

/** One immutable version of a team-level review submission. New submissions never overwrite old ones. */
const submissionSchema = new Schema(
  {
    team: { type: Schema.Types.ObjectId, ref: "Team", required: true },
    section: { type: Schema.Types.ObjectId, ref: "Section", required: true },
    reviewKey: { type: String, required: true },
    reviewType: { type: String, required: true },
    version: { type: Number, required: true },
    isLatest: { type: Boolean, default: true },
    status: { type: String, enum: Object.values(SUBMISSION_STATUS), default: SUBMISSION_STATUS.SUBMITTED },
    submittedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    submittedByName: String,
    submittedAt: { type: Date, default: Date.now },
    isLate: { type: Boolean, default: false },
    data: { type: Schema.Types.Mixed, default: {} },
    file: {
      type: new Schema({ storedName: String, originalName: String, size: Number, mimeType: String, sha256: String }, { _id: false }),
      default: undefined,
    },
    reviewHistory: [reviewEntry],
  },
  { timestamps: true }
);

submissionSchema.index({ team: 1, reviewKey: 1, version: 1 }, { unique: true });
submissionSchema.index({ team: 1, reviewKey: 1, isLatest: 1 });
submissionSchema.index({ section: 1, status: 1, isLatest: 1 });

export default mongoose.model("Submission", submissionSchema);
