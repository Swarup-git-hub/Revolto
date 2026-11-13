import Contribution from "../../models/Contribution.js";
import Submission from "../../models/Submission.js";
import Team from "../../models/Team.js";
import User from "../../models/User.js";
import { CONTRIBUTION_STATUS, SUBMISSION_STATUS } from "../../shared/constants.js";
import { badRequest, conflict, forbidden, notFound } from "../../shared/errors.js";
import { notify } from "../../shared/notify.js";
import { removeTemp, finalizeUpload } from "../../shared/upload.js";
import { getEffectiveReview } from "./reviewConfig.service.js";
import { validateContribution, validateFields, validateMilestones } from "./validateData.js";

const S = SUBMISSION_STATUS;

async function nextVersion(Model, filter) {
  const last = await Model.findOne(filter, "version").sort({ version: -1 }).lean();
  return (last?.version || 0) + 1;
}

/** Inserts a new immutable version; retries if two submissions race for the same version number. */
async function insertVersioned(Model, filter, build) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const version = await nextVersion(Model, filter);
    try {
      return await Model.create(build(version));
    } catch (err) {
      if (err?.code !== 11000 || attempt === 3) throw err;
    }
  }
}

function assertTeamActive(team) {
  if (team.status !== "active") throw conflict("This team is archived and can no longer submit");
}

/** Team leader submits (or resubmits) a team-level review. Previous versions are always kept. */
export async function submitTeamReview({ user, team, reviewKey, rawData, file }) {
  try {
    assertTeamActive(team);
    const cfg = await getEffectiveReview(team.section, reviewKey);
    if (!cfg) throw notFound("Review not found for this team's section");

    const latest = await Submission.findOne({ team: team._id, reviewKey, isLatest: true }).lean();
    if (latest?.status === S.APPROVED && (cfg.type === "report" || cfg.type === "title")) {
      throw conflict(cfg.type === "title" ? "The title is already confirmed. Ask your guide to change it." : "The final report is already approved.");
    }

    const data = validateFields(cfg, rawData);
    if (cfg.type === "progress") data.milestones = validateMilestones(cfg, rawData?.milestones);

    let fileMeta;
    if (file) {
      if (!cfg.upload?.enabled) throw badRequest("This review does not accept file uploads");
      fileMeta = await finalizeUpload(file, { acceptedTypes: cfg.upload.acceptedTypes, maxSizeMB: cfg.upload.maxSizeMB, folder: String(team._id) });
    } else if (cfg.upload?.required) {
      throw badRequest("A file is required for this review", { file: `Upload a ${cfg.upload.acceptedTypes.join("/").toUpperCase()} file` });
    }

    const submission = await insertVersioned(Submission, { team: team._id, reviewKey }, (version) => ({
      team: team._id, section: team.section, reviewKey, reviewType: cfg.type, version,
      status: S.SUBMITTED, submittedBy: user._id, submittedByName: user.name, submittedAt: new Date(),
      isLate: Boolean(cfg.deadline && Date.now() > new Date(cfg.deadline).getTime()),
      data, ...(fileMeta ? { file: fileMeta } : {}),
    }));

    // Retire the previous "latest" pointer; undecided versions become "superseded", decided ones keep their outcome.
    await Submission.updateMany({ team: team._id, reviewKey, _id: { $ne: submission._id }, isLatest: true }, { $set: { isLatest: false } });
    await Submission.updateMany({ team: team._id, reviewKey, _id: { $ne: submission._id }, status: { $in: [S.SUBMITTED, S.UNDER_REVIEW] } }, { $set: { status: S.SUPERSEDED } });

    if (cfg.type === "title") {
      const newTitle = data.projectTitle;
      const set = { titleStatus: "submitted", projectTitle: newTitle };
      const push = team.projectTitle && team.projectTitle !== newTitle ? { titleHistory: { oldTitle: team.projectTitle, newTitle, actor: user._id, actorName: user.name, reason: "Submitted by team leader" } } : null;
      await Team.updateOne({ _id: team._id }, { $set: set, ...(push ? { $push: push } : {}) });
    }
    await notify([team.guide], { type: "review_submitted", title: "New submission to review", message: `${team.teamId} submitted ${cfg.name} (version ${submission.version}).`, link: `/teams/${team._id}` });
    return submission;
  } catch (err) {
    await removeTemp(file);
    throw err;
  }
}

/** Assigned Guide records a review decision on the latest version. Feedback history is append-only. */
export async function reviewSubmission({ user, submissionId, decision, feedback }) {
  const sub = await Submission.findById(submissionId);
  if (!sub) throw notFound("Submission not found");
  const team = await Team.findOne({ _id: sub.team, guide: user._id });
  if (!team) throw notFound("Submission not found");
  if (!sub.isLatest) throw conflict("A newer version has been submitted; review that version instead");
  if (![S.UNDER_REVIEW, S.APPROVED, S.CHANGES_REQUIRED].includes(decision)) throw badRequest("Invalid decision");
  if (decision === S.CHANGES_REQUIRED && (!feedback || feedback.trim().length < 3)) throw badRequest("Explain what needs to change", { feedback: "Feedback is required when requesting changes" });
  const allowed = { [S.SUBMITTED]: [S.UNDER_REVIEW, S.APPROVED, S.CHANGES_REQUIRED], [S.UNDER_REVIEW]: [S.APPROVED, S.CHANGES_REQUIRED], [S.APPROVED]: [S.CHANGES_REQUIRED], [S.CHANGES_REQUIRED]: [] };
  if (!(allowed[sub.status] || []).includes(decision)) throw conflict(`A submission that is "${sub.status.replace("_", " ")}" cannot be moved to "${decision.replace("_", " ")}"`);

  sub.status = decision;
  sub.reviewHistory.push({ decision, feedback: (feedback || "").trim(), by: user._id, byName: user.name, at: new Date() });
  await sub.save();

  if (sub.reviewType === "title") {
    if (decision === S.APPROVED) await Team.updateOne({ _id: team._id }, { $set: { titleStatus: "confirmed" } });
    if (decision === S.CHANGES_REQUIRED) await Team.updateOne({ _id: team._id }, { $set: { titleStatus: "changes_required" } });
  }
  const members = await User.find({ team: team._id, isActive: true }, "_id").lean();
  const label = { under_review: "is under review", approved: "was approved", changes_required: "needs changes" }[decision];
  await notify(members.map((m) => m._id), { type: "review_decision", title: "Guide feedback", message: `Your ${sub.reviewKey} submission (v${sub.version}) ${label}.`, link: `/teams/${team._id}` });
  return sub;
}

/** A student records their own contribution. It stays "pending review" until the Guide acknowledges it. */
export async function submitContribution({ user, team, reviewKey, rawData }) {
  assertTeamActive(team);
  const member = await User.exists({ _id: user._id, team: team._id, isActive: true });
  if (!member) throw forbidden("Only members of this team can record contributions");
  const cfg = await getEffectiveReview(team.section, reviewKey);
  if (!cfg || cfg.type !== "progress" || !cfg.individualContributions) throw badRequest("This review does not collect individual contributions");
  const data = validateContribution(cfg, rawData);
  const contribution = await insertVersioned(Contribution, { team: team._id, reviewKey, student: user._id }, (version) => ({
    team: team._id, section: team.section, reviewKey, student: user._id, studentName: user.name, version,
    status: CONTRIBUTION_STATUS.PENDING, submittedAt: new Date(), data,
  }));
  await Contribution.updateMany({ team: team._id, reviewKey, student: user._id, _id: { $ne: contribution._id }, isLatest: true }, { $set: { isLatest: false } });
  await Contribution.updateMany({ team: team._id, reviewKey, student: user._id, _id: { $ne: contribution._id }, status: CONTRIBUTION_STATUS.PENDING }, { $set: { status: CONTRIBUTION_STATUS.SUPERSEDED } });
  await notify([team.guide], { type: "contribution_submitted", title: "Contribution recorded", message: `${user.name} (${team.teamId}) updated their contribution.`, link: `/teams/${team._id}` });
  return contribution;
}

export async function reviewContribution({ user, contributionId, decision, feedback }) {
  const c = await Contribution.findById(contributionId);
  if (!c) throw notFound("Contribution not found");
  const team = await Team.findOne({ _id: c.team, guide: user._id });
  if (!team) throw notFound("Contribution not found");
  if (!c.isLatest) throw conflict("A newer version has been recorded; review that version instead");
  if (!["acknowledged", "changes_required"].includes(decision)) throw badRequest("Invalid decision");
  if (decision === "changes_required" && (!feedback || feedback.trim().length < 3)) throw badRequest("Explain what needs to change", { feedback: "Feedback is required when requesting changes" });
  c.status = decision;
  c.reviewHistory.push({ decision, feedback: (feedback || "").trim(), by: user._id, byName: user.name, at: new Date() });
  await c.save();
  await notify([c.student], { type: "contribution_decision", title: "Guide feedback on your contribution", message: decision === "acknowledged" ? "Your contribution was acknowledged by your guide." : "Your guide asked for changes to your contribution.", link: `/teams/${team._id}` });
  return c;
}
