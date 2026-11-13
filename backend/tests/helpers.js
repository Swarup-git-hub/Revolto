import "./setup-env.js";
import http from "node:http";
import mongoose from "mongoose";
import { createApp } from "../src/app.js";
import { signToken } from "../src/shared/auth.js";
import Section from "../src/models/Section.js";
import Team from "../src/models/Team.js";
import User from "../src/models/User.js";
import { ensureDefaultReviews } from "../src/modules/reviews/reviewConfig.service.js";
import { getSettings } from "../src/shared/settings.js";
import { reconcileCounters } from "../src/shared/counters.js";

const BASE = process.env.MONGO_TEST_URI || "mongodb://127.0.0.1:27018";

/** Boots an additional HTTP server for the app (same database connection) with custom createApp options, e.g. tight rate limits. */
export async function serve(options) {
  const server = http.createServer(createApp(options));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}/api`, stop: () => new Promise((r) => server.close(r)) };
}

export async function startApp(name) {
  await mongoose.connect(`${BASE}/reviewslot_test_${name}?directConnection=true`);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  await getSettings();
  await ensureDefaultReviews();
  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/api`;
  return {
    url,
    async stop() {
      await new Promise((r) => server.close(r));
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    },
  };
}

/** Minimal HTTP client returning {status, body, headers, text}. */
export function client(url, token) {
  const call = async (method, path, body, extra = {}) => {
    const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra.headers };
    let payload = extra.rawBody;
    if (body !== undefined && payload === undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${url}${path}`, { method, headers, body: payload });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, body: json, text, headers: res.headers };
  };
  return {
    get: (p) => call("GET", p),
    post: (p, b) => call("POST", p, b ?? {}),
    patch: (p, b) => call("PATCH", p, b ?? {}),
    put: (p, b) => call("PUT", p, b ?? {}),
    delete: (p) => call("DELETE", p),
    /** multipart: data object + optional {name, buffer} file */
    async upload(p, data, file) {
      const fd = new FormData();
      fd.append("data", JSON.stringify(data));
      if (file) fd.append("file", new Blob([file.buffer]), file.name);
      const res = await fetch(`${url}${p}`, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* binary/other */ }
      return { status: res.status, body: json, text };
    },
    async raw(p) {
      const res = await fetch(`${url}${p}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()), headers: res.headers };
    },
  };
}

/**
 * Builds a small college: sections A and B; HOD; coordinators for each section; two guides;
 * teams A-T01 (guide1, leader s1 + s2), A-T02 (guide2, s3 + s4), B-T01 (guide1, s5 + s6).
 */
export async function buildWorld(url) {
  const A = await Section.create({ name: "A" });
  const B = await Section.create({ name: "B" });
  const mk = (email, fields) => User.create({ email, ...fields });
  const hod = await mk("hod@t.edu", { name: "HOD", role: "hod" });
  const coordA = await mk("ca@t.edu", { name: "Coord A", role: "coordinator", sections: [A._id] });
  const coordB = await mk("cb@t.edu", { name: "Coord B", role: "coordinator", sections: [B._id] });
  const g1 = await mk("g1@t.edu", { name: "Guide One", role: "guide" });
  const g2 = await mk("g2@t.edu", { name: "Guide Two", role: "guide" });
  const st = [];
  for (let i = 1; i <= 7; i++) st.push(await mk(`s${i}@t.edu`, { name: `Student ${i}`, role: "student", rollNumber: `R${i}`, section: i <= 4 ? A._id : B._id }));
  const team = async (teamId, sec, guide, members) => {
    const t = await Team.create({ teamId, section: sec._id, guide: guide._id, leader: members[0]._id });
    await User.updateMany({ _id: { $in: members.map((m) => m._id) } }, { $set: { team: t._id } });
    return t;
  };
  const tA1 = await team("A-T01", A, g1, [st[0], st[1]]);
  const tA2 = await team("A-T02", A, g2, [st[2], st[3]]);
  const tB1 = await team("B-T01", B, g1, [st[4], st[5]]);
  await reconcileCounters(); // the world is built with direct inserts, so derive the seat/workload counters once
  const tok = async (u) => signToken(await User.findById(u._id));
  const api = async (u) => client(url, await tok(u));
  return { A, B, users: { hod, coordA, coordB, g1, g2, st }, teams: { tA1, tA2, tB1 }, api, tok, anon: client(url) };
}

export const pdf = (extra = "") => Buffer.from(`%PDF-1.4\n1 0 obj<<>>endobj\n${extra}\n%%EOF`);
export const futureDate = (days = 3) => new Date(Date.now() + days * 86400000 + 330 * 60000).toISOString().slice(0, 10);
