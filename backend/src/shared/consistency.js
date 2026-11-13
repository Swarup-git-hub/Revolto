import BookingRequest from "../models/BookingRequest.js";
import BookingSlot from "../models/BookingSlot.js";
import Section from "../models/Section.js";
import Submission from "../models/Submission.js";
import Team from "../models/Team.js";
import User from "../models/User.js";
import { reconcileCounters } from "./counters.js";
import { getSettings } from "./settings.js";

/**
 * Read-only invariant check. Returns [{ level: "violation" | "warning", rule, detail }].
 * Violations mean the data contradicts a rule the application guarantees; warnings are suspicious but possible
 * (e.g. a limit lowered after teams already existed).
 */
export async function checkConsistency() {
  const out = [];
  const add = (level, rule, detail) => out.push({ level, rule, detail });
  const settings = await getSettings();

  // teams ↔ members ↔ leader
  const teams = await Team.find({}, "teamId section guide leader status").lean();
  const members = await User.aggregate([{ $match: { team: { $ne: null }, role: "student", isActive: true } }, { $group: { _id: "$team", ids: { $push: "$_id" } } }]);
  const byTeam = new Map(members.map((m) => [String(m._id), m.ids.map(String)]));
  for (const t of teams) {
    const ids = byTeam.get(String(t._id)) || [];
    if (t.status === "active" && ids.length && !t.leader) add("violation", "team-has-leader", `${t.teamId} has ${ids.length} member(s) but no leader`);
    if (t.leader && !ids.includes(String(t.leader))) add("violation", "leader-is-member", `${t.teamId}: the leader is not an active member of the team`);
  }
  const teamIds = new Set(teams.map((t) => String(t._id)));
  const teamSection = new Map(teams.map((t) => [String(t._id), String(t.section)]));
  for (const s of await User.find({ team: { $ne: null }, role: "student" }, "rollNumber team section").lean()) {
    if (!teamIds.has(String(s.team))) add("violation", "member-team-exists", `student ${s.rollNumber} points at a missing team`);
    else if (String(s.section) !== teamSection.get(String(s.team))) add("violation", "member-section-matches-team", `student ${s.rollNumber} is in a different section than their team`);
  }

  // derived counters
  const drift = await reconcileCounters({ dryRun: true });
  for (const d of drift.sections) add("violation", "section-counter", `section ${d.section}: counter ${d.from} but ${d.to} active students`);
  for (const d of drift.guides) add("violation", "guide-counter", `${d.guide}: counter ${d.from} but ${d.to} active teams`);
  for (const g of await User.find({ role: "guide", activeTeamCount: { $gt: settings.guide.maxTeams } }, "name activeTeamCount").lean()) add("warning", "guide-over-limit", `${g.name} has ${g.activeTeamCount} teams (limit ${settings.guide.maxTeams}); allowed only if the limit was lowered later`);
  for (const s of await Section.find({ isActive: true }, "name studentCount capacity").lean()) {
    const cap = s.capacity || settings.section.defaultCapacity;
    if (cap && s.studentCount > cap) add("warning", "section-over-capacity", `section ${s.name} has ${s.studentCount} students (capacity ${cap})`);
  }

  // bookings: one live request per slot / per team+review, and slot status mirrors the live request
  const live = await BookingRequest.find({ active: true }, "slot team reviewKey status").lean();
  const slotSeen = new Map(), teamSeen = new Set();
  for (const r of live) {
    if (slotSeen.has(String(r.slot))) add("violation", "one-live-request-per-slot", `slot ${r.slot} has more than one live request`);
    slotSeen.set(String(r.slot), r);
    const k = `${r.team}:${r.reviewKey}`;
    if (teamSeen.has(k)) add("violation", "one-live-request-per-team-review", `team ${r.team} has more than one live request for ${r.reviewKey}`);
    teamSeen.add(k);
  }
  const expected = { pending: "pending", approved: "booked" };
  for (const s of await BookingSlot.find({ status: { $in: ["pending", "booked"] } }, "status").lean()) {
    const r = slotSeen.get(String(s._id));
    if (!r || expected[r.status] !== s.status) add("violation", "slot-status-matches-request", `slot ${s._id} is "${s.status}" but its live request is ${r ? `"${r.status}"` : "missing"}`);
  }
  for (const [slotId, r] of slotSeen) {
    const slot = await BookingSlot.findById(slotId, "status").lean();
    if (!slot || slot.status !== expected[r.status]) add("violation", "request-slot-status", `live ${r.status} request on slot ${slotId} whose status is "${slot?.status}"`);
  }

  // submissions: exactly one latest version per team+review
  const dup = await Submission.aggregate([{ $match: { isLatest: true } }, { $group: { _id: { t: "$team", r: "$reviewKey" }, n: { $sum: 1 } } }, { $match: { n: { $ne: 1 } } }]);
  for (const d of dup) add("violation", "single-latest-submission", `team ${d._id.t} / ${d._id.r} has ${d.n} "latest" versions`);
  return out;
}
