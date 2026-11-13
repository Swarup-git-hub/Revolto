import mongoose from "mongoose";
import { ROLE_LIST } from "../shared/constants.js";

const { Schema } = mongoose;

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
    role: { type: String, enum: ROLE_LIST, default: "student", required: true },
    rollNumber: { type: String, uppercase: true, trim: true, maxlength: 40 },
    phone: { type: String, trim: true, maxlength: 20 },
    /** Students: their section. Guides/coordinators/HOD: unused. */
    section: { type: Schema.Types.ObjectId, ref: "Section", default: null },
    /** Coordinators: the sections they are assigned to. */
    sections: [{ type: Schema.Types.ObjectId, ref: "Section" }],
    /** Students: the single team they belong to (source of truth for membership). */
    team: { type: Schema.Types.ObjectId, ref: "Team", default: null },
    isActive: { type: Boolean, default: true },
    archivedAt: { type: Date, default: null },
    /** Guides: number of ACTIVE teams (workload). Maintained atomically; derived data, see reconcileCounters(). */
    activeTeamCount: { type: Number, min: 0 }, // deliberately NO default (absent = not initialised); see Section.studentCount
    /** Incremented on logout / deactivation so previously issued tokens stop working. */
    tokenVersion: { type: Number, default: 0 },
    otp: {
      type: new Schema(
        {
          hash: String,
          expiresAt: Date,
          verifyAttempts: { type: Number, default: 0 },
          lastSentAt: Date,
          windowStart: Date,
          requestsInWindow: { type: Number, default: 0 },
        },
        { _id: false }
      ),
      select: false,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

userSchema.index({ rollNumber: 1 }, { unique: true, partialFilterExpression: { rollNumber: { $type: "string" } } });
userSchema.index({ role: 1, isActive: 1 });
userSchema.index({ section: 1, role: 1 });
userSchema.index({ team: 1 });

export default mongoose.model("User", userSchema);
