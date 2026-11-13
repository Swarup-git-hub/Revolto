// A second API "instance" (separate process) used to verify cross-instance Socket.IO delivery.
// env: MONGO_URI, JWT_SECRET, REDIS_URL (optional). Prints "PORT <n>" when ready.
import "../setup-env.js";
import http from "node:http";
import mongoose from "mongoose";
import { attachRedisAdapter, initSocket } from "../../src/shared/socket.js";
import "../../src/models/User.js";

await mongoose.connect(process.env.MONGO_URI);
const server = http.createServer((_q, r) => r.end("ok"));
const io = initSocket(server, ["http://localhost"]);
if (process.env.REDIS_URL) await attachRedisAdapter(io, process.env.REDIS_URL);
server.listen(0, "127.0.0.1", () => console.log(`PORT ${server.address().port}`));
process.on("SIGTERM", () => process.exit(0));
