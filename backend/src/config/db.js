import mongoose from "mongoose";
import { env } from "./env.js";

mongoose.set("strictQuery", true);

/** `readOnly: true` stops Mongoose from creating collections/indexes as a side effect of connecting (used by verify-deployment). */
export async function connectDb(uri = env.mongoUri, { readOnly = false } = {}) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000, ...(readOnly ? { autoIndex: false, autoCreate: false } : {}) });
  return mongoose.connection;
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
