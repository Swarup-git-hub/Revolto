import mongoose from "mongoose";

const { Schema } = mongoose;

const sectionSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true, maxlength: 40 },
    /** Maximum students in the section; null falls back to Settings.section.defaultCapacity (null = unlimited). */
    capacity: { type: Number, default: null, min: 1 },
    /** Optional section-level booking overrides, always bounded by the college policy. */
    booking: {
      enabled: { type: Boolean, default: null },
      requestBy: { type: String, enum: ["any_member", "leader", null], default: null },
      cutoffHoursBeforeSlot: { type: Number, default: null, min: 0 },
    },
    /**
     * Active students currently holding a seat. Maintained atomically by reserveSeat/releaseSeat so capacity cannot be
     * exceeded by concurrent requests. It is derived data: `reconcileCounters()` recomputes it from the users collection.
     */
    studentCount: { type: Number, min: 0 }, // deliberately NO default: absent = "not initialised yet" (see ensureCounter); a default would be written back by save() on legacy documents and corrupt the count
    isActive: { type: Boolean, default: true },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("Section", sectionSchema);
