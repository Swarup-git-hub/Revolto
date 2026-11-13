import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { buildWorld, futureDate, startApp } from "./helpers.js";
import BookingSlot from "../src/models/BookingSlot.js";

let app, w;
before(async () => { app = await startApp("slotrace"); w = await buildWorld(app.url); });
after(() => app.stop());

test("slot generation relies on bulk-insert semantics: with ordered:false the non-duplicates are inserted and reported exactly", async () => {
  const g = new mongoose.Types.ObjectId();
  const mk = (m) => ({ guide: g, reviewKey: "review-2", date: "2031-01-01", startMin: m, endMin: m + 30 });
  await BookingSlot.create(mk(60));
  let err;
  await BookingSlot.insertMany([mk(30), mk(60), mk(90)], { ordered: false }).catch((e) => { err = e; });
  assert.equal(err.code, 11000);
  assert.equal(err.insertedDocs.length, 2, "this is what POST /bookings/slots uses to count 'created'");
  assert.equal(await BookingSlot.countDocuments({ guide: g }), 3);
});

test("simultaneous identical slot generation never duplicates slots and the reported counts add up", async () => {
  const guide = await w.api(w.users.g1);
  const body = { mode: "range", reviewKey: "review-2", dateFrom: futureDate(3), dateTo: futureDate(5), weekdays: [0, 1, 2, 3, 4, 5, 6], windows: [{ start: "09:00", end: "11:00" }], durationMinutes: 30, skipConflicts: true };
  const rs = await Promise.all(Array.from({ length: 5 }, () => guide.post("/bookings/slots", body)));
  const created = rs.filter((r) => r.status === 201).reduce((n, r) => n + r.body.created, 0);
  assert.equal(await BookingSlot.countDocuments({ guide: w.users.g1._id }), 12, "exactly the 3 days × 4 slots, no duplicates");
  assert.equal(created, 12, "the 'created' numbers of all callers add up to what exists");
  assert.ok(rs.every((r) => [201, 409].includes(r.status)), "no 500s: " + rs.map((r) => r.status));
});
