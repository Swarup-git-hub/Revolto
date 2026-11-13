import mongoose from "mongoose";
import { TITLE_STATUS } from "../shared/constants.js";

const { Schema } = mongoose;

const teamSchema = new Schema(
  {
    /** Explicit, human-readable identifier, e.g. "A-T01". Unique across the college. */
    teamId: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 30 },
    section: { type: Schema.Types.ObjectId, ref: "Section", required: true },
    guide: { type: Schema.Types.ObjectId, ref: "User", required: true },
    leader: { type: Schema.Types.ObjectId, ref: "User", default: null },
    /** Centrally managed project title. */
    projectTitle: { type: String, trim: true, maxlength: 200, default: "" },
    titleStatus: { type: String, enum: TITLE_STATUS, default: "not_submitted" },
    titleHistory: [
      {
        _id: false,
        oldTitle: String,
        newTitle: String,
        actor: { type: Schema.Types.ObjectId, ref: "User" },
        actorName: String,
        reason: String,
        at: { type: Date, default: Date.now },
      },
    ],
    status: { type: String, enum: ["active", "archived"], default: "active" },
    archivedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

teamSchema.index({ section: 1, status: 1 });
teamSchema.index({ guide: 1, status: 1 });

export default mongoose.model("Team", teamSchema);
