import Contribution from "../../models/Contribution.js";
import ReviewConfig from "../../models/ReviewConfig.js";
import Submission from "../../models/Submission.js";
import User from "../../models/User.js";

const NOT_SUBMITTED = "not_submitted";

/**
 * Builds a progress summary for each team from recorded data only.
 *  - review status  : where each review stands in the submit -> guide-review lifecycle
 *  - milestones     : counts taken from the latest recorded progress checklist
 * The two are reported separately and never merged into a single percentage.
 */
export async function computeProgress(teams) {
  if (!teams.length) return new Map();
  const teamIds = teams.map((t) => t._id);
  const sectionIds = [...new Set(teams.map((t) => String(t.section?._id || t.section)))];

  const [configs, latestSubs, latestContribs, members] = await Promise.all([
    ReviewConfig.find({ archivedAt: null, $or: [{ section: null }, { section: { $in: sectionIds } }] }).lean(),
    Submission.find({ team: { $in: teamIds }, isLatest: true }, "-reviewHistory").lean(),
    Contribution.find({ team: { $in: teamIds }, isLatest: true }, "-reviewHistory").lean(),
    User.find({ team: { $in: teamIds }, role: "student", isActive: true }, "name rollNumber team").sort({ rollNumber: 1 }).lean(),
  ]);

  const reviewsFor = (sectionId) => {
    const byKey = new Map();
    for (const c of configs.filter((c) => !c.section || String(c.section) === sectionId).sort((a, b) => (a.section ? 1 : 0) - (b.section ? 1 : 0))) byKey.set(c.key, c);
    return [...byKey.values()].sort((a, b) => a.order - b.order);
  };
  const subsBy = (arr, keyFn) => {
    const map = new Map();
    for (const item of arr) {
      const k = keyFn(item);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(item);
    }
    return map;
  };
  const subsByTeam = subsBy(latestSubs, (s) => String(s.team));
  const contribByTeam = subsBy(latestContribs, (c) => String(c.team));
  const membersByTeam = subsBy(members, (m) => String(m.team));

  const result = new Map();
  for (const team of teams) {
    const id = String(team._id);
    const reviews = reviewsFor(String(team.section?._id || team.section));
    const subs = subsByTeam.get(id) || [];
    const rows = reviews.map((r) => {
      const s = subs.find((x) => x.reviewKey === r.key);
      return {
        key: r.key, name: r.name, order: r.order, type: r.type, deadline: r.deadline,
        status: s ? s.status : NOT_SUBMITTED,
        version: s?.version || 0,
        submittedAt: s?.submittedAt || null,
        isLate: Boolean(s?.isLate),
        submissionId: s ? String(s._id) : null,
      };
    });
    const current = rows.find((r) => r.status !== "approved") || null;

    // Milestones: from the latest recorded progress-type submission (highest review order wins).
    let milestones = { recorded: false, total: 0, completed: 0, inProgress: 0, notStarted: 0, items: [], reviewKey: null, asOf: null };
    const progressReviews = reviews.filter((r) => r.type === "progress").reverse();
    for (const pr of progressReviews) {
      const s = subs.find((x) => x.reviewKey === pr.key);
      if (!s) continue;
      const active = (pr.milestones || []).filter((m) => !m.deprecated);
      const items = active.map((m) => {
        const rec = (s.data?.milestones || []).find((x) => x.key === m.key);
        return { key: m.key, label: m.label, status: rec?.status || "not_started", percent: rec?.percent ?? null };
      });
      milestones = {
        recorded: true,
        total: items.length,
        completed: items.filter((i) => i.status === "completed").length,
        inProgress: items.filter((i) => i.status === "in_progress").length,
        notStarted: items.filter((i) => i.status === "not_started").length,
        items, reviewKey: pr.key, asOf: s.submittedAt,
      };
      break;
    }
    const improvements = [...reviews].reverse().find((r) => r.type === "improvements");
    const impSub = improvements && subs.find((x) => x.reviewKey === improvements.key);
    const reportReview = reviews.find((r) => r.type === "report");
    const reportSub = reportReview && subs.find((x) => x.reviewKey === reportReview.key);

    const contribs = contribByTeam.get(id) || [];
    const milestoneLabel = (reviewKey, key) => reviews.find((r) => r.key === reviewKey)?.milestones?.find((m) => m.key === key)?.label || key;
    const memberRows = (membersByTeam.get(id) || []).map((m) => {
      const mine = contribs.filter((c) => String(c.student) === String(m._id)).sort((a, b) => b.submittedAt - a.submittedAt);
      const latest = mine[0];
      // recorded content per review, exactly as the student wrote it (self-reported, never "verified")
      const byReview = {};
      for (const c of mine) {
        byReview[c.reviewKey] = {
          status: c.status, version: c.version, submittedAt: c.submittedAt,
          summary: c.data?.summary || "",
          tasks: (c.data?.tasks || []).map((t) => ({ milestone: milestoneLabel(c.reviewKey, t.milestoneKey), description: t.description, status: t.status })),
        };
      }
      return { id: String(m._id), name: m.name, rollNumber: m.rollNumber, contributionStatus: latest ? latest.status : "not_recorded", contributionRecordedAt: latest?.submittedAt || null, contributionVersion: latest?.version || 0, contributionReviewKey: latest?.reviewKey || null, contributions: byReview };
    });
    const dates = [...subs.map((s) => s.submittedAt), ...contribs.map((c) => c.submittedAt)].filter(Boolean);

    result.set(id, {
      reviews: rows,
      reviewsApproved: rows.filter((r) => r.status === "approved").length,
      reviewsSubmitted: rows.filter((r) => r.status !== NOT_SUBMITTED).length,
      reviewsTotal: rows.length,
      currentReview: current ? { key: current.key, name: current.name, status: current.status } : null,
      milestones,
      progressState: !milestones.recorded ? "not_recorded" : milestones.completed === milestones.total ? "completed" : "in_progress",
      pendingWork: impSub?.data?.pendingWork || null,
      reportStatus: reportReview ? (reportSub ? reportSub.status : NOT_SUBMITTED) : null,
      members: memberRows,
      lastUpdate: dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null,
    });
  }
  return result;
}
