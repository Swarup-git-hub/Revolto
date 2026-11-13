import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { io as connect } from "socket.io-client";
import { createClient } from "redis";
import { buildWorld, startApp } from "./helpers.js";
import { attachRedisAdapter, closeSocket, emitToUsers, initSocket } from "../src/shared/socket.js";

const REDIS = process.env.REDIS_TEST_URL || "redis://127.0.0.1:6390";
const here = path.dirname(fileURLToPath(import.meta.url));
const DB = "mongodb://127.0.0.1:27018/reviewslot_test_socketredis?directConnection=true";
let app, w, token, redisUp = false, closers = [], children = [], parentServer;

async function redisReachable() {
  const c = createClient({ url: REDIS, socket: { connectTimeout: 1500, reconnectStrategy: false } });
  c.on("error", () => {});
  try { await c.connect(); await c.quit(); return true; } catch { return false; }
}
function startInstance(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(here, "fixtures", "socket-instance.js")], { env: { PATH: process.env.PATH, MONGO_URI: DB, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    children.push(child);
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.stdout.on("data", (d) => { const m = /PORT (\d+)/.exec(String(d)); if (m) resolve(Number(m[1])); });
    child.on("exit", (c) => reject(new Error(`instance exited early (${c}): ${err}`)));
    setTimeout(() => reject(new Error(`instance did not start: ${err}`)), 15000);
  });
}
const waitEvent = (socket, event, ms) => new Promise((resolve) => { const t = setTimeout(() => resolve(null), ms); socket.once(event, (p) => { clearTimeout(t); resolve(p); }); });
const connected = (port, auth) => new Promise((resolve) => { const s = connect(`http://127.0.0.1:${port}`, { auth, transports: ["websocket"], reconnection: false }); s.on("connect", () => resolve({ s })); s.on("connect_error", (e) => resolve({ s, error: e.message })); });

before(async () => {
  redisUp = await redisReachable();
  app = await startApp("socketredis");
  w = await buildWorld(app.url);
  token = await w.tok(w.users.st[0]);
  if (!redisUp) return;
  parentServer = http.createServer((_q, r) => r.end("ok"));
  const io = initSocket(parentServer, ["http://localhost"]);
  closers.push(await attachRedisAdapter(io, REDIS));
  await new Promise((r) => parentServer.listen(0, "127.0.0.1", r));
});
after(async () => {
  for (const c of children) c.kill("SIGTERM");
  await closeSocket();
  for (const close of closers) await close();
  await app.stop();
});

test("socket connections require a valid token", async (t) => {
  if (!redisUp) return t.skip(`Redis not reachable at ${REDIS}`);
  const port = parentServer.address().port;
  assert.equal((await connected(port, {})).error, "unauthorized");
  assert.equal((await connected(port, { token: "garbage" })).error, "unauthorized");
  const ok = await connected(port, { token });
  assert.equal(ok.error, undefined);
  ok.s.close();
});

test("with the Redis adapter, an event emitted on instance A reaches a user connected to instance B (and not without it)", async (t) => {
  if (!redisUp) return t.skip(`Redis not reachable at ${REDIS}`);
  const base = { JWT_SECRET: process.env.JWT_SECRET };
  const portShared = await startInstance({ ...base, REDIS_URL: REDIS });
  const portIsolated = await startInstance(base);
  const viaShared = (await connected(portShared, { token })).s;
  const isolated = (await connected(portIsolated, { token })).s;
  const other = (await connected(portShared, { token: await w.tok(w.users.st[1]) })).s; // a different user on the same instance
  await new Promise((r) => setTimeout(r, 300)); // let rooms join

  const gotShared = waitEvent(viaShared, "notification", 3000);
  const gotIsolated = waitEvent(isolated, "notification", 1000);
  const gotOther = waitEvent(other, "notification", 1000);
  emitToUsers([w.users.st[0]._id], "notification", { type: "ping" }); // emitted by THIS process (instance A)

  assert.deepEqual(await gotShared, { type: "ping" }, "delivered across instances through Redis");
  assert.equal(await gotIsolated, null, "control: an instance without the adapter never sees it");
  assert.equal(await gotOther, null, "events are addressed to one user only");
  for (const s of [viaShared, isolated, other]) s.close();
});

test("attachRedisAdapter fails fast with a clear error when Redis is unreachable", async () => {
  const srv = http.createServer();
  const io = (await import("socket.io")).Server;
  const t0 = Date.now();
  await assert.rejects(attachRedisAdapter(new io(srv), "redis://127.0.0.1:1"), /Cannot connect to Redis for Socket\.IO.*REDIS_URL/);
  assert.ok(Date.now() - t0 < 7000, "gives up within seconds instead of retrying forever");
});
