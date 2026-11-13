import { Server } from "socket.io";
import { authenticateToken } from "./auth.js";

let io = null;

/**
 * Optional: lets several API instances share Socket.IO events through Redis, so a notification created on instance A
 * reaches a user connected to instance B. Without it each instance only reaches its own sockets (clients also poll
 * notifications every 90 s, so the UI still catches up). Operational cost: one Redis server to run and secure.
 */
export async function attachRedisAdapter(server, url) {
  let createAdapter, createClient;
  try {
    ({ createAdapter } = await import("@socket.io/redis-adapter"));
    ({ createClient } = await import("redis"));
  } catch {
    throw new Error("REDIS_URL is set but the optional packages are missing. Run: npm install @socket.io/redis-adapter redis");
  }
  const pub = createClient({ url });
  const sub = pub.duplicate();
  pub.on("error", (e) => console.error("Redis (socket adapter) error:", e.message));
  sub.on("error", (e) => console.error("Redis (socket adapter) error:", e.message));
  // Fail fast at startup if Redis cannot be reached (the client would otherwise retry forever). After a successful start it
  // keeps its normal automatic reconnection.
  let timer;
  try {
    await Promise.race([Promise.all([pub.connect(), sub.connect()]), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timed out after 5 s")), 5000); })]);
  } catch (err) {
    await Promise.allSettled([pub.disconnect(), sub.disconnect()]);
    throw new Error(`Cannot connect to Redis for Socket.IO (${err.message}). Check REDIS_URL.`);
  } finally {
    clearTimeout(timer);
  }
  server.adapter(createAdapter(pub, sub));
  return async () => { await Promise.allSettled([pub.quit(), sub.quit()]); };
}

/** Sockets are authenticated with the same JWT and only receive events addressed to their own user room. */
export function initSocket(httpServer, origins) {
  io = new Server(httpServer, { cors: { origin: origins, credentials: true } });
  io.use(async (socket, next) => {
    try {
      socket.data.user = await authenticateToken(socket.handshake.auth?.token);
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });
  io.on("connection", (socket) => {
    socket.join(`user:${socket.data.user.id}`);
  });
  return io;
}

export const closeSocket = () => new Promise((resolve) => (io ? io.close(() => { io = null; resolve(); }) : resolve()));

/** Events carry only a small hint ({type, id}); clients refetch through the authorised REST API. */
export function emitToUsers(userIds, event, payload = {}) {
  if (!io) return;
  for (const id of new Set(userIds.map(String))) io.to(`user:${id}`).emit(event, payload);
}
