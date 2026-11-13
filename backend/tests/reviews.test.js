import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildWorld, pdf, startApp } from "./helpers.js";
import Submission from "../src/models/Submission.js";
import ReviewConfig from "../src/models/ReviewConfig.js";
import { env } from "../src/config/env.js";

let app, w, leader, member, guide, coord, hod, otherGuide;
before(async () => {
  app = await startApp("reviews");
  w = await buildWorld(app.url);
  leader = await w.api(w.users.st[0]); member = await w.api(w.users.st[1]);
  guide = await w.api(w.users.g1); otherGuide = await w.api(w.users.g2);
  coord = await w.api(w.users.coordA); hod = await w.api(w.users.hod);
});
after(async () => { fs.rmSync(env.uploadDir, { recursive: true, force: true }); await app.stop(); });

const r1 = (o = {}) => ({ projectTitle: "Smart Attendance", problemStatement: "Manual attendance is slow", objectives: "Automate it", requirementsStatus: "in_progress", ...o });
const ms = (statuses) => ["requirements", "frontend", "backend", "database", "integration", "testing"].map((key, i) => ({ key, status: statuses[i] || "not_started" }));

test("default review sequence exists in the expected order", async () => {
  const r = await leader.get("/reviews/config");
  assert.deepEqual(r.body.reviews.map((x) => x.key), ["review-1", "review-2", "review-3", "review-4"]);
  assert.match(r.body.reviews[0].name, /Project Title and Initial Requirements/);
  assert.equal(r.body.reviews[3].upload.required, true);
  assert.deepEqual(r.body.reviews[3].upload.acceptedTypes, ["pdf"]);
  assert.equal(r.body.reviews[1].milestones.length, 6);
});

test("Review 1: leader submits, guide requests changes, leader resubmits, guide confirms; all versions kept", async () => {
  const bad = await leader.post("/teams/A-T01/reviews/review-1/submissions", r1({ objectives: "" }));
  assert.equal(bad.status, 400);
  assert.ok(bad.body.details.objectives);
  const s1 = await leader.post("/teams/A-T01/reviews/review-1/submissions", r1());
  assert.equal(s1.status, 201);
  assert.equal(s1.body.submission.version, 1);
  let team = (await leader.get("/teams/A-T01")).body.team;
  assert.equal(team.projectTitle, "Smart Attendance");
  assert.equal(team.titleStatus, "submitted");

  assert.equal((await otherGuide.post(`/submissions/${s1.body.submission.id}/review`, { decision: "approved" })).status, 404, "unassigned guide");
  assert.equal((await guide.post(`/submissions/${s1.body.submission.id}/review`, { decision: "changes_required" })).status, 400, "feedback required");
  const ch = await guide.post(`/submissions/${s1.body.submission.id}/review`, { decision: "changes_required", feedback: "Narrow the title to one domain" });
  assert.equal(ch.status, 200);
  team = (await leader.get("/teams/A-T01")).body.team;
  assert.equal(team.titleStatus, "changes_required");

  const s2 = await leader.post("/teams/A-T01/reviews/review-1/submissions", r1({ projectTitle: "Face-based Attendance" }));
  assert.equal(s2.body.submission.version, 2);
  const ok = await guide.post(`/submissions/${s2.body.submission.id}/review`, { decision: "approved", feedback: "Good" });
  assert.equal(ok.status, 200);
  team = (await leader.get("/teams/A-T01")).body.team;
  assert.equal(team.titleStatus, "confirmed");
  assert.equal(team.projectTitle, "Face-based Attendance");
  assert.ok(team.titleHistory.some((h) => h.oldTitle === "Smart Attendance" && h.newTitle === "Face-based Attendance"));

  const hist = (await leader.get("/teams/A-T01/reviews/review-1/submissions")).body.submissions;
  assert.equal(hist.length, 2);
  assert.equal(hist[1].reviewHistory[0].feedback, "Narrow the title to one domain", "earlier feedback preserved");
  assert.equal((await leader.get(`/teams/A-T01/reviews/review-1/submissions`)).body.submissions.filter((s) => s.isLatest).length, 1);
  // once confirmed the team cannot silently change the title by resubmitting
  assert.equal((await leader.post("/teams/A-T01/reviews/review-1/submissions", r1({ projectTitle: "Sneaky" }))).status, 409);
  // an earlier version can no longer be decided
  assert.equal((await guide.post(`/submissions/${s1.body.submission.id}/review`, { decision: "approved" })).status, 409);
});

test("Review 2: team progress requires the full milestone checklist and rejects inconsistent values", async () => {
  const none = await leader.post("/teams/A-T01/reviews/review-2/submissions", { summary: "Started" });
  assert.equal(none.status, 400);
  const inconsistent = await leader.post("/teams/A-T01/reviews/review-2/submissions", { summary: "s", milestones: ms(["completed"]).map((m, i) => (i === 0 ? { ...m, percent: 40 } : m)) });
  assert.equal(inconsistent.status, 400);
  const unknown = await leader.post("/teams/A-T01/reviews/review-2/submissions", { summary: "s", milestones: [...ms([]), { key: "made-up", status: "completed" }].slice(1) });
  assert.equal(unknown.status, 400, "missing milestone is not assumed");
  const ok = await leader.post("/teams/A-T01/reviews/review-2/submissions", { summary: "Requirements and UI done", milestones: ms(["completed", "in_progress"]) });
  assert.equal(ok.status, 201);
  const detail = (await coord.get("/teams/A-T01")).body.team;
  assert.equal(detail.progress.milestones.completed, 1);
  assert.equal(detail.progress.milestones.total, 6);
  const r2 = detail.progress.reviews.find((r) => r.key === "review-2");
  assert.equal(r2.status, "submitted", "visible to the coordinator immediately, guide status shown separately");
  assert.equal(detail.progress.reviewsApproved, 1, "review completion (Review 1 only) is separate from milestone progress");
});

test("Review 2: each member records an individual contribution; it is pending, not 'verified'; versions kept", async () => {
  const c1 = await member.post("/teams/A-T01/reviews/review-2/contributions", { summary: "Built the login screen", tasks: [{ milestoneKey: "frontend", description: "Login page", status: "completed", percent: 100 }] });
  assert.equal(c1.status, 201);
  assert.equal(c1.body.contribution.status, "pending_review");
  const badTask = await member.post("/teams/A-T01/reviews/review-2/contributions", { summary: "x", tasks: [{ milestoneKey: "nope", description: "d", status: "completed" }] });
  assert.equal(badTask.status, 400);
  const c2 = await member.post("/teams/A-T01/reviews/review-2/contributions", { summary: "Login + dashboard", tasks: [] });
  assert.equal(c2.body.contribution.version, 2);
  const all = (await member.get("/teams/A-T01/reviews/review-2/contributions")).body.contributions;
  assert.equal(all.length, 2);
  assert.equal(all.find((c) => c.version === 1).status, "superseded");

  const ack = await guide.post(`/contributions/${c2.body.contribution.id}/review`, { decision: "acknowledged" });
  assert.equal(ack.body.contribution.status, "acknowledged");
  assert.equal((await otherGuide.post(`/contributions/${c2.body.contribution.id}/review`, { decision: "acknowledged" })).status, 404);
  const detail = (await leader.get("/teams/A-T01")).body.team;
  const m = detail.members.find((x) => x.name === "Student 2");
  assert.equal(m.contributionStatus, "acknowledged");
  assert.equal(detail.members.find((x) => x.name === "Student 1").contributionStatus, "not_recorded", "no data is invented for members who recorded nothing");
  // team progress and individual contribution are distinct records
  assert.equal((await Submission.countDocuments({ team: w.teams.tA1._id, reviewKey: "review-2" })), 1);
});

test("Review 2: guide requests corrections, leader resubmits, previous version and feedback are preserved", async () => {
  const latest = (await guide.get("/reviews/queue")).body.submissions.find((s) => s.reviewKey === "review-2");
  assert.ok(latest, "appears in the guide queue");
  await guide.post(`/submissions/${latest.id}/review`, { decision: "under_review" });
  await guide.post(`/submissions/${latest.id}/review`, { decision: "changes_required", feedback: "Backend status looks optimistic - add detail" });
  assert.equal((await guide.get("/reviews/queue")).body.awaitingCorrection.length, 1);
  const again = await leader.post("/teams/A-T01/reviews/review-2/submissions", { summary: "Added detail", milestones: ms(["completed", "in_progress", "in_progress"]) });
  assert.equal(again.body.submission.version, 2);
  const hist = (await leader.get("/teams/A-T01/reviews/review-2/submissions")).body.submissions;
  assert.equal(hist.length, 2);
  const v1 = hist.find((h) => h.version === 1);
  assert.equal(v1.status, "changes_required", "decided versions keep their outcome");
  assert.deepEqual(v1.reviewHistory.map((x) => x.decision), ["under_review", "changes_required"]);
  assert.equal(v1.data.summary, "Requirements and UI done", "old data untouched");
});

test("Review 3: structured fields, optional document, and comparison with Review 2 without inventing completion", async () => {
  const missing = await leader.post("/teams/A-T01/reviews/review-3/submissions", { newFeatures: "x" });
  assert.equal(missing.status, 400);
  const ok = await leader.upload("/teams/A-T01/reviews/review-3/submissions", { newFeatures: "QR check-in", completedImprovements: "Faster queries", testingStatus: "in_progress", pendingWork: "Load testing" }, { name: "notes.pdf", buffer: pdf() });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.submission.file.name, "notes.pdf");
  const noDoc = await leader.post("/teams/A-T01/reviews/review-3/submissions", { newFeatures: "Another", completedImprovements: "x", testingStatus: "not_started" });
  assert.equal(noDoc.status, 201, "document is optional for Review 3");
  const cmp = (await leader.get("/teams/A-T01/compare?from=review-2&to=review-3")).body;
  assert.equal(cmp.from.submission.data.milestones.find((m) => m.key === "backend").status, "in_progress");
  assert.equal(cmp.to.submission.data.testingStatus, "not_started");
  assert.equal(cmp.milestones.items.find((m) => m.key === "testing").status, "not_started", "Review 3 'testing' text does not flip the Review 2 milestone");
});

test("Review 4: PDF-only upload, size limit, signature check, versions, guide approval, authorised download", async () => {
  const noFile = await leader.post("/teams/A-T01/reviews/review-4/submissions", {});
  assert.equal(noFile.status, 400);
  const wrongExt = await leader.upload("/teams/A-T01/reviews/review-4/submissions", {}, { name: "report.exe", buffer: pdf() });
  assert.equal(wrongExt.status, 400);
  const fake = await leader.upload("/teams/A-T01/reviews/review-4/submissions", {}, { name: "report.pdf", buffer: Buffer.from("MZ not a pdf at all") });
  assert.equal(fake.status, 400);
  assert.match(fake.body.error, /does not match/);
  await ReviewConfig.updateOne({ key: "review-4", section: null }, { $set: { "upload.maxSizeMB": 1 } });
  const big = await leader.upload("/teams/A-T01/reviews/review-4/submissions", {}, { name: "big.pdf", buffer: Buffer.concat([pdf(), Buffer.alloc(1.5 * 1024 * 1024)]) });
  assert.equal(big.status, 400);
  assert.match(big.body.error, /too large/);
  await ReviewConfig.updateOne({ key: "review-4", section: null }, { $set: { "upload.maxSizeMB": 10 } });
  assert.equal((await member.upload("/teams/A-T01/reviews/review-4/submissions", {}, { name: "r.pdf", buffer: pdf() })).status, 403, "member, not leader");

  const v1 = await leader.upload("/teams/A-T01/reviews/review-4/submissions", { notes: "first draft" }, { name: "../../evil/report v1.pdf", buffer: pdf("v1") });
  assert.equal(v1.status, 201);
  assert.ok(!v1.body.submission.file.name.includes("/"), "path components are stripped from the stored name");
  assert.equal((await guide.post(`/submissions/${v1.body.submission.id}/review`, { decision: "changes_required", feedback: "Add chapter 5" })).status, 200);
  const v2 = await leader.upload("/teams/A-T01/reviews/review-4/submissions", {}, { name: "report-v2.pdf", buffer: pdf("v2") });
  assert.equal(v2.body.submission.version, 2);
  assert.equal((await guide.post(`/submissions/${v2.body.submission.id}/review`, { decision: "approved" })).status, 200);
  assert.equal((await leader.upload("/teams/A-T01/reviews/review-4/submissions", {}, { name: "again.pdf", buffer: pdf() })).status, 409, "approved report is final");

  const hist = (await coord.get("/teams/A-T01/reviews/review-4/submissions")).body.submissions;
  assert.deepEqual(hist.map((h) => [h.version, h.status]), [[2, "approved"], [1, "changes_required"]]);
  // files live under a random name inside the private upload dir, not under the original name
  const stored = (await Submission.findById(v1.body.submission.id).lean()).file.storedName;
  assert.ok(!stored.includes("evil") && fs.existsSync(path.join(env.uploadDir, stored)));

  // download authorisation
  for (const who of [leader, member, guide, coord, hod]) {
    const d = await who.raw(`/submissions/${v1.body.submission.id}/file`);
    assert.equal(d.status, 200);
    assert.ok(d.buffer.subarray(0, 5).equals(Buffer.from("%PDF-")));
    assert.match(d.headers.get("content-disposition"), /^attachment/);
  }
  for (const who of [otherGuide, await w.api(w.users.coordB), await w.api(w.users.st[2])]) assert.equal((await who.raw(`/submissions/${v1.body.submission.id}/file`)).status, 404);
  assert.equal((await w.anon.get(`/submissions/${v1.body.submission.id}/file`)).status, 401);
});

test("review configuration: coordinator may only touch own section; reviews with history are archived, not deleted", async () => {
  const college = (await hod.get("/reviews/config?raw=true")).body.reviews.find((r) => r.key === "review-2");
  assert.equal((await coord.patch(`/reviews/config/${college.id}`, { name: "Hacked" })).status, 403, "college-wide config is HOD only");
  const ov = await coord.post(`/reviews/config/${college.id}/override`, { section: String(w.A._id) });
  assert.equal(ov.status, 201);
  const upd = await coord.patch(`/reviews/config/${ov.body.review.id}`, { name: "Review 2 — Section A progress", deadline: "2030-01-01T00:00:00Z" });
  assert.equal(upd.status, 200);
  const eff = (await leader.get("/reviews/config")).body.reviews.find((r) => r.key === "review-2");
  assert.equal(eff.name, "Review 2 — Section A progress", "section override applies to that section's students");
  const effB = (await (await w.api(w.users.st[4])).get("/reviews/config")).body.reviews.find((r) => r.key === "review-2");
  assert.equal(effB.name, "Review 2 — Project Progress");
  // protected: cannot drop a milestone that has records
  const cut = await coord.patch(`/reviews/config/${ov.body.review.id}`, { milestones: ov.body.review.milestones.slice(1) });
  assert.equal(cut.status, 409);
  // can deprecate instead
  const dep = await coord.patch(`/reviews/config/${ov.body.review.id}`, { milestones: ov.body.review.milestones.map((m) => (m.key === "database" ? { ...m, deprecated: true } : m)) });
  assert.equal(dep.status, 200);
  const del = await hod.delete(`/reviews/config/${college.id}`);
  assert.equal(del.body.archived, true);
  assert.ok(await ReviewConfig.findById(college.id), "archived, not removed");
  assert.ok((await Submission.countDocuments({ reviewKey: "review-2" })) > 0, "history intact");
  // a brand-new unused review can be removed outright
  const fresh = await hod.post("/reviews/config", { key: "review-5", name: "Extra", order: 5, type: "improvements" });
  assert.equal(fresh.status, 201);
  assert.equal((await hod.delete(`/reviews/config/${fresh.body.review.id}`)).body.archived, false);
});
