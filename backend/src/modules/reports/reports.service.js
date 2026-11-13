import Team from "../../models/Team.js";
import { teamScopeFilter } from "../../shared/scope.js";
import { computeProgress } from "../reviews/progress.service.js";

const LABEL = {
  not_submitted: "Not submitted", submitted: "Submitted", under_review: "Under review", changes_required: "Changes required", approved: "Approved",
  not_recorded: "Not recorded", pending_review: "Pending review (self-reported)", acknowledged: "Acknowledged by guide", in_progress: "In progress", completed: "All milestones completed",
};
export const label = (s) => LABEL[s] || s || "";

export const TEAM_COLUMNS = ["Team ID", "Project title", "Section", "Guide", "Member count", "Current review", "Progress status", "Completed milestones", "Pending work", "Guide review status", "Last update"];
export const STUDENT_COLUMNS = ["Roll number", "Name", "Section", "Team ID", "Project title", "Guide", "Recorded contributions", "Contribution status", "Contribution review", "Contribution summary", "Contribution tasks", "Final report status", "Guide feedback status"];

const TASK_STATUS = { not_started: "not started", in_progress: "in progress", completed: "completed" };
const taskLine = (t) => `${t.milestone}: ${t.description} (${TASK_STATUS[t.status] || t.status})`;

/**
 * Returns team rows and student rows for the user's scope, honouring filters. Only recorded data is reported.
 * With `filters.review` the review is matched EXACTLY: teams for which that review is not configured are left out
 * (and counted in `meta.excludedTeams`) instead of silently reporting a different review.
 */
export async function buildReportData(user, filters = {}) {
  const and = [teamScopeFilter(user), { status: filters.includeArchived ? { $in: ["active", "archived"] } : "active" }];
  if (filters.section) and.push({ section: filters.section });
  if (filters.guide) and.push({ guide: filters.guide });
  if (filters.team) and.push({ teamId: String(filters.team).toUpperCase() });
  const teams = await Team.find({ $and: and }).populate("section", "name").populate("guide", "name").sort({ teamId: 1 }).lean();
  const progress = await computeProgress(teams);
  const teamRows = [];
  const studentRows = [];
  let excludedTeams = 0;

  for (const t of teams) {
    const p = progress.get(String(t._id));
    let cur;
    if (filters.review) {
      cur = p.reviews.find((r) => r.key === filters.review);
      if (!cur) { excludedTeams++; continue; } // review not available to this team's section
    } else {
      cur = p.currentReview ? p.reviews.find((r) => r.key === p.currentReview.key) : p.reviews[p.reviews.length - 1];
    }
    const guideStatus = cur ? cur.status : "not_submitted";
    if (filters.progress && p.progressState !== filters.progress) continue;
    if (filters.submissionStatus && guideStatus !== filters.submissionStatus) continue;
    const pending = p.pendingWork || p.milestones.items.filter((i) => i.status !== "completed").map((i) => i.label).join("; ");
    teamRows.push({
      "Team ID": t.teamId,
      "Project title": t.projectTitle || "",
      Section: t.section.name,
      Guide: t.guide.name,
      "Member count": p.members.length,
      "Current review": cur ? cur.name : "",
      "Progress status": p.milestones.recorded ? `${label(p.progressState)} (${p.milestones.completed} of ${p.milestones.total} milestones)` : label("not_recorded"),
      "Completed milestones": p.milestones.items.filter((i) => i.status === "completed").map((i) => i.label).join("; "),
      "Pending work": pending,
      "Guide review status": label(guideStatus),
      "Last update": p.lastUpdate ? p.lastUpdate.toISOString() : "",
    });
    for (const m of p.members) {
      // Contribution shown: the one for the selected review, otherwise the student's most recent one. Status and
      // version count are separate fields; nothing is ever described as verified unless the Guide acknowledged it.
      const key = filters.review || m.contributionReviewKey;
      const c = key ? m.contributions[key] : null;
      studentRows.push({
        "Roll number": m.rollNumber || "",
        Name: m.name,
        Section: t.section.name,
        "Team ID": t.teamId,
        "Project title": t.projectTitle || "",
        Guide: t.guide.name,
        "Recorded contributions": c ? c.version : 0,
        "Contribution status": label(c ? c.status : "not_recorded"),
        "Contribution review": c ? (p.reviews.find((r) => r.key === key)?.name || key) : "",
        "Contribution summary": c ? c.summary : "",
        "Contribution tasks": c ? c.tasks.map(taskLine).join("; ") : "",
        "Final report status": label(p.reportStatus || "not_submitted"),
        "Guide feedback status": label(guideStatus),
      });
    }
  }
  return { teamRows, studentRows, meta: { excludedTeams } };
}
