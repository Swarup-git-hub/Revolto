import Section from "../models/Section.js";
import Team from "../models/Team.js";
import User from "../models/User.js";

/**
 * Recomputes the derived counters from the source-of-truth collections and reports every correction.
 * Idempotent and safe to run any time; for an exact result run it while no one is creating students/teams
 * (it is run automatically at server start). Needed after direct database edits, crashes between "reserve" and
 * "create", or when upgrading from a version without counters.
 */
export async function reconcileSectionCounts({ dryRun = false } = {}) {
  const rows = await User.aggregate([{ $match: { role: "student", isActive: true, section: { $ne: null } } }, { $group: { _id: "$section", n: { $sum: 1 } } }]);
  const real = new Map(rows.map((r) => [String(r._id), r.n]));
  const corrections = [];
  for (const s of await Section.find({}, "name studentCount").lean()) {
    const n = real.get(String(s._id)) || 0;
    if (s.studentCount !== n) {
      if (!dryRun) await Section.updateOne({ _id: s._id }, { $set: { studentCount: n } });
      corrections.push({ section: s.name, from: s.studentCount ?? null, to: n });
    }
  }
  return corrections;
}

export async function reconcileGuideCounts({ dryRun = false } = {}) {
  const rows = await Team.aggregate([{ $match: { status: "active" } }, { $group: { _id: "$guide", n: { $sum: 1 } } }]);
  const real = new Map(rows.map((r) => [String(r._id), r.n]));
  const corrections = [];
  for (const g of await User.find({ role: "guide" }, "name activeTeamCount").lean()) {
    const n = real.get(String(g._id)) || 0;
    if (g.activeTeamCount !== n) {
      if (!dryRun) await User.updateOne({ _id: g._id }, { $set: { activeTeamCount: n } });
      corrections.push({ guide: g.name, from: g.activeTeamCount ?? null, to: n });
    }
  }
  return corrections;
}

export async function reconcileCounters(opts) {
  return { sections: await reconcileSectionCounts(opts), guides: await reconcileGuideCounts(opts) };
}
