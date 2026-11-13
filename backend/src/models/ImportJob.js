import mongoose from "mongoose";

const { Schema } = mongoose;

const importJobSchema = new Schema(
  {
    type: { type: String, enum: ["students", "teams", "staff"], required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    fileName: String,
    status: { type: String, enum: ["previewed", "confirmed"], default: "previewed" },
    rows: [
      new Schema(
        {
          _id: false,
          rowNumber: Number,
          status: { type: String, enum: ["valid", "error", "duplicate"] },
          problems: [String],
          raw: Schema.Types.Mixed,
          normalized: Schema.Types.Mixed,
        },
        { _id: false }
      ),
    ],
    summary: { total: Number, valid: Number, errors: Number, duplicates: Number },
    result: { created: Number, skipped: Number, failed: Number, failures: [String] },
    confirmedAt: Date,
    /** Unconfirmed previews are discarded after 24 hours. Confirmed jobs are kept (expireAt unset). */
    expireAt: { type: Date, default: () => new Date(Date.now() + 24 * 3600 * 1000) },
  },
  { timestamps: true }
);

importJobSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("ImportJob", importJobSchema);
