import { Download, FileText, History as HistoryIcon, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, describeError, download } from "../../lib/api.js";
import { fmtDateTime, fmtSize } from "../../lib/format.js";
import { useLoad } from "../../lib/hooks.js";
import { toast } from "../../store/toast.js";
import { Alert, Async, Button, Card, EmptyState, Modal, StatusBadge } from "../ui/index.jsx";
import { Field, Textarea } from "../ui/fields.jsx";
import { DynamicForm, MilestoneEditor, SubmissionData, TaskEditor } from "./FormParts.jsx";

/* ---------- guide decision dialog (shared by submissions and contributions) ---------- */
function DecisionDialog({ open, onClose, title, options, onSubmit }) {
  const [decision, setDecision] = useState(options[0]?.value);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState({});
  useEffect(() => { if (open) { setDecision(options[0]?.value); setFeedback(""); setErr({}); } }, [open]); // eslint-disable-line
  const needsFeedback = options.find((o) => o.value === decision)?.feedbackRequired;
  const go = async () => {
    setBusy(true);
    try { await onSubmit(decision, feedback); onClose(); } catch (e) { const d = describeError(e); setErr({ message: d.message, ...d.fields }); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={title} footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={go}>Save decision</Button></>}>
      <div className="space-y-4">
        {err.message && !err.feedback && <Alert tone="danger">{err.message}</Alert>}
        <fieldset className="space-y-2">
          <legend className="label">Decision</legend>
          {options.map((o) => (
            <label key={o.value} className="well flex cursor-pointer items-start gap-3 p-3">
              <input type="radio" name="decision" className="mt-1 accent-[#3F5F7A]" checked={decision === o.value} onChange={() => setDecision(o.value)} />
              <span><span className="block text-[14.5px] font-semibold">{o.label}</span><span className="block text-[13px] text-ink-mute">{o.hint}</span></span>
            </label>
          ))}
        </fieldset>
        <Textarea label={needsFeedback ? "Feedback (required)" : "Feedback (optional)"} rows={4} value={feedback} onChange={(e) => setFeedback(e.target.value)} error={err.feedback} />
      </div>
    </Modal>
  );
}

const SUB_DECISIONS = [
  { value: "under_review", label: "Mark as under review", hint: "Let the team know you are looking at it." },
  { value: "approved", label: "Approve", hint: "Accept this version." },
  { value: "changes_required", label: "Request changes", hint: "The team leader can correct and resubmit. Earlier versions stay on record.", feedbackRequired: true },
];

function ReviewTrail({ items }) {
  if (!items?.length) return null;
  return (
    <ul className="mt-3 space-y-2 border-l-2 border-stone-tint pl-4">
      {items.map((h, i) => (
        <li key={i} className="text-[13.5px]">
          <div className="flex flex-wrap items-center gap-2"><StatusBadge status={h.decision} /><span className="text-ink-mute">{h.by} · {fmtDateTime(h.at)}</span></div>
          {h.feedback && <p className="mt-1 whitespace-pre-wrap text-ink-soft">{h.feedback}</p>}
        </li>
      ))}
    </ul>
  );
}

/* ---------- main review panel ---------- */
export default function ReviewPanel({ team, review, user, onChanged }) {
  const isLeader = user.role === "student" && team.leader?.id === user.id;
  const isGuide = user.role === "guide" && team.guide.id === user.id;
  const subs = useLoad(() => api.get(`/teams/${team.id}/reviews/${review.key}/submissions`).then((r) => r.data.submissions), [team.id, review.key]);
  const [values, setValues] = useState({});
  const [milestones, setMilestones] = useState([]);
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [decide, setDecide] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const latest = subs.data?.find((s) => s.isLatest);
  useEffect(() => {
    // prefill the form from the latest version so corrections are quick
    const d = latest?.data || {};
    const { milestones: ms, ...rest } = d;
    setValues(rest);
    setMilestones(ms || []);
  }, [latest?.id]); // eslint-disable-line

  const locked = (review.type === "report" || review.type === "title") && latest?.status === "approved";
  const canSubmit = isLeader && team.status === "active" && !locked;
  const mustWait = latest && ["submitted", "under_review"].includes(latest.status);

  const submit = async () => {
    setBusy(true); setErrors({}); setFormError("");
    const data = review.type === "progress" ? { ...values, milestones } : values;
    try {
      let res;
      if (review.upload?.enabled) {
        const fd = new FormData();
        fd.append("data", JSON.stringify(data));
        if (file) fd.append("file", file);
        res = await api.post(`/teams/${team.id}/reviews/${review.key}/submissions`, fd);
      } else res = await api.post(`/teams/${team.id}/reviews/${review.key}/submissions`, data);
      toast.success(`Submitted as version ${res.data.submission.version}.`);
      setFile(null); setShowForm(false);
      subs.reload(); onChanged();
    } catch (e) { const d = describeError(e); setFormError(d.message); setErrors(d.fields); } finally { setBusy(false); }
  };

  const decideSub = async (decision, feedback) => {
    await api.post(`/submissions/${decide.id}/review`, { decision, feedback });
    toast.success("Decision saved.");
    subs.reload(); onChanged();
  };

  const headerDeadline = review.deadline ? `Deadline: ${fmtDateTime(review.deadline)}` : "No deadline set";

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[18px] font-bold">{review.name}</h2>
            <p className="text-[13.5px] text-ink-mute">{headerDeadline}</p>
          </div>
          <StatusBadge status={latest?.status || "not_submitted"} />
        </div>

        <div className="mt-5">
          <Async state={subs} rows={2}>
            {() => latest ? (
              <div className="space-y-4">
                <div className="text-[13.5px] text-ink-mute">Version {latest.version} · submitted by {latest.submittedBy.name} · {fmtDateTime(latest.submittedAt)}{latest.isLate ? " · after the deadline" : ""}</div>
                <SubmissionData review={review} data={latest.data} />
                {latest.file && (
                  <button type="button" className="btn-soft btn-sm" onClick={() => download(`/submissions/${latest.id}/file`, latest.file.name).catch((e) => toast.error(describeError(e).message))}>
                    <Download size={15} />{latest.file.name} <span className="font-normal text-ink-mute">({fmtSize(latest.file.size)})</span>
                  </button>
                )}
                <ReviewTrail items={latest.reviewHistory} />
                {isGuide && team.status === "active" && latest.status !== "changes_required" && (
                  <Button variant="soft" onClick={() => setDecide(latest)}>Record decision</Button>
                )}
                {latest.status === "changes_required" && isLeader && <Alert tone="warning">Your guide asked for changes. Update the form below and submit a new version — the previous version and feedback stay on record.</Alert>}
                {latest.status === "changes_required" && !isLeader && <Alert tone="warning">Waiting for the team leader to correct and resubmit.</Alert>}
              </div>
            ) : (
              <EmptyState icon={FileText} title="Nothing submitted yet" hint={isLeader ? "Use the form below to make the first submission." : "The team leader submits this review for the team."} />
            )}
          </Async>
        </div>
      </Card>

      {canSubmit && (
        <Card>
          {!showForm && !(latest && latest.status === "changes_required") ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[14.5px] text-ink-soft">{mustWait ? "A version is awaiting your guide. Submitting again creates a new version and supersedes the pending one." : latest ? "Need to update something? Submit a new version." : "Ready to submit?"}</p>
              <Button onClick={() => setShowForm(true)}><Send size={16} />{latest ? "Submit a new version" : "Start submission"}</Button>
            </div>
          ) : (
            <form noValidate className="space-y-5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
              <h3 className="text-[16px] font-bold">{latest ? `New version (v${latest.version + 1})` : "Submission"}</h3>
              {formError && <Alert tone="danger">{formError}</Alert>}
              <DynamicForm fields={review.fields} values={values} onChange={setValues} errors={errors} />
              {review.type === "progress" && <MilestoneEditor milestones={review.milestones} value={milestones} onChange={setMilestones} errors={errors} />}
              {review.upload?.enabled && (
                <Field label={`File ${review.upload.required ? "" : "(optional)"}`} required={review.upload.required} error={errors.file} help={`${review.upload.acceptedTypes.join(", ").toUpperCase()} · up to ${review.upload.maxSizeMB} MB`}>
                  <input type="file" className="field" accept={review.upload.acceptedTypes.map((t) => `.${t}`).join(",")} onChange={(e) => setFile(e.target.files?.[0] || null)} />
                </Field>
              )}
              <div className="flex gap-2"><Button type="submit" loading={busy}><Send size={16} />Submit</Button>{showForm && <Button variant="soft" onClick={() => setShowForm(false)}>Cancel</Button>}</div>
            </form>
          )}
        </Card>
      )}
      {!canSubmit && locked && isLeader && <Alert tone="success">This submission is {review.type === "title" ? "confirmed" : "approved"}. Contact your guide if something needs to change.</Alert>}
      {user.role === "student" && !isLeader && <Alert tone="info">Only the team leader submits team-level reviews. You can record your own contribution{review.individualContributions ? " below" : " under Review 2"}.</Alert>}

      {review.type === "progress" && review.individualContributions && <ContributionPanel team={team} review={review} user={user} isGuide={isGuide} onChanged={onChanged} />}
      {review.type === "improvements" && <Comparison team={team} review={review} />}

      <Card>
        <h3 className="mb-3 flex items-center gap-2 text-[16px] font-bold"><HistoryIcon size={17} />Version history</h3>
        <Async state={subs} rows={2} isEmpty={(d) => !d.length} empty={<p className="text-[14px] text-ink-mute">No versions yet.</p>}>
          {(list) => (
            <ul className="space-y-2">
              {list.map((s) => (
                <li key={s.id}>
                  <details className="well px-4 py-3">
                    <summary className="flex cursor-pointer flex-wrap items-center gap-3 text-[14px] font-semibold">
                      Version {s.version}<StatusBadge status={s.isLatest && s.status === "submitted" ? "submitted" : s.status} />
                      <span className="font-normal text-ink-mute">{s.submittedBy.name} · {fmtDateTime(s.submittedAt)}</span>
                    </summary>
                    <div className="mt-3 space-y-3">
                      <SubmissionData review={review} data={s.data} />
                      {s.file && <button type="button" className="btn-soft btn-sm" onClick={() => download(`/submissions/${s.id}/file`, s.file.name).catch((e) => toast.error(describeError(e).message))}><Download size={14} />{s.file.name}</button>}
                      <ReviewTrail items={s.reviewHistory} />
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </Async>
      </Card>

      <DecisionDialog open={Boolean(decide)} onClose={() => setDecide(null)} title={`Decision on version ${decide?.version}`} options={decide?.status === "approved" ? SUB_DECISIONS.filter((o) => o.value === "changes_required") : decide?.status === "under_review" ? SUB_DECISIONS.slice(1) : SUB_DECISIONS} onSubmit={decideSub} />
    </div>
  );
}

/* ---------- individual contributions (Review 2) ---------- */
function ContributionPanel({ team, review, user, isGuide, onChanged }) {
  const list = useLoad(() => api.get(`/teams/${team.id}/reviews/${review.key}/contributions`).then((r) => r.data.contributions), [team.id, review.key]);
  const isMember = user.role === "student" && team.members?.some((m) => m.id === user.id);
  const [form, setForm] = useState({ summary: "", notes: "", tasks: [] });
  const [errors, setErrors] = useState({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [decide, setDecide] = useState(null);

  const latestByStudent = useMemo(() => {
    const m = new Map();
    (list.data || []).forEach((c) => { if (c.isLatest) m.set(c.student.id, c); });
    return m;
  }, [list.data]);
  const mine = latestByStudent.get(user.id);
  const startForm = () => { setForm(mine ? { summary: mine.data.summary, notes: mine.data.notes || "", tasks: mine.data.tasks || [] } : { summary: "", notes: "", tasks: [] }); setOpen(true); };

  const save = async () => {
    setBusy(true); setErrors({}); setMsg("");
    try { await api.post(`/teams/${team.id}/reviews/${review.key}/contributions`, form); toast.success("Your contribution was recorded and is pending your guide's review."); setOpen(false); list.reload(); onChanged(); }
    catch (e) { const d = describeError(e); setMsg(d.message); setErrors(d.fields); } finally { setBusy(false); }
  };

  return (
    <Card>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[16px] font-bold">Individual contributions</h3>
        {isMember && !open && <Button variant="soft" size="sm" onClick={startForm}>{mine ? "Update my contribution" : "Record my contribution"}</Button>}
      </div>
      <p className="mb-4 text-[13.5px] text-ink-mute">Each member records their own work. Entries are self-reported and are not treated as verified until the guide acknowledges them.</p>

      {open && (
        <form noValidate className="well mb-5 space-y-4 p-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
          {msg && <Alert tone="danger">{msg}</Alert>}
          <Textarea label="What did you work on?" required value={form.summary} error={errors.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
          <TaskEditor milestones={review.milestones} tasks={form.tasks} onChange={(tasks) => setForm({ ...form, tasks })} errors={errors} />
          <Textarea label="Notes (optional)" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <div className="flex gap-2"><Button type="submit" loading={busy}>Save contribution</Button><Button variant="soft" onClick={() => setOpen(false)}>Cancel</Button></div>
        </form>
      )}

      <Async state={list} rows={2}>
        {() => (
          <ul className="space-y-3">
            {(team.members || []).map((m) => {
              const c = latestByStudent.get(m.id);
              const history = (list.data || []).filter((x) => x.student.id === m.id && !x.isLatest);
              return (
                <li key={m.id} className="well p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[14.5px] font-semibold">{m.name}{m.isLeader && <span className="ml-2 text-[12px] font-normal text-ink-mute">Team leader</span>}<span className="ml-2 text-[12.5px] font-normal text-ink-mute">{m.rollNumber}</span></div>
                    <StatusBadge status={c ? c.status : "not_recorded"} />
                  </div>
                  {c && (
                    <div className="mt-2 space-y-2 text-[14px]">
                      <p className="whitespace-pre-wrap">{c.data.summary}</p>
                      {c.data.tasks?.length > 0 && <ul className="list-disc pl-5 text-ink-soft">{c.data.tasks.map((t, i) => <li key={i}>{review.milestones.find((x) => x.key === t.milestoneKey)?.label}: {t.description} <span className="text-ink-mute">({t.status.replace("_", " ")})</span></li>)}</ul>}
                      <div className="text-[12.5px] text-ink-mute">Version {c.version} · {fmtDateTime(c.submittedAt)}</div>
                      <ReviewTrail items={c.reviewHistory} />
                      {isGuide && c.status === "pending_review" && <Button variant="soft" size="sm" onClick={() => setDecide(c)}>Review contribution</Button>}
                      {history.length > 0 && <details className="text-[13px] text-ink-mute"><summary className="cursor-pointer font-semibold">{history.length} earlier version(s)</summary><ul className="mt-2 space-y-1">{history.map((h) => <li key={h.id}>v{h.version} · {fmtDateTime(h.submittedAt)} · {h.data.summary.slice(0, 120)}</li>)}</ul></details>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Async>
      <DecisionDialog open={Boolean(decide)} onClose={() => setDecide(null)} title={`Contribution by ${decide?.student.name}`}
        options={[{ value: "acknowledged", label: "Acknowledge", hint: "You have reviewed this contribution." }, { value: "changes_required", label: "Request changes", hint: "The student can update and resubmit.", feedbackRequired: true }]}
        onSubmit={async (decision, feedback) => { await api.post(`/contributions/${decide.id}/review`, { decision, feedback }); toast.success("Decision saved."); list.reload(); onChanged(); }} />
    </Card>
  );
}

/* ---------- Review 3 vs Review 2 (recorded data only) ---------- */
function Comparison({ team, review }) {
  const prev = "review-2";
  const cmp = useLoad(() => api.get(`/teams/${team.id}/compare?from=${prev}&to=${review.key}`).then((r) => r.data), [team.id, review.key]);
  return (
    <Card>
      <h3 className="mb-1 text-[16px] font-bold">Compare with Review 2</h3>
      <p className="mb-4 text-[13.5px] text-ink-mute">Shows what was recorded in each review. Nothing is inferred: Review 3 entries do not change Review 2 milestone statuses.</p>
      <Async state={cmp} rows={2}>
        {(c) => (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="well p-4">
              <h4 className="mb-2 text-[14px] font-bold">Review 2 — milestones (latest version)</h4>
              {c.from.submission ? <ul className="space-y-1.5">{c.milestones.items.map((m) => <li key={m.key} className="flex items-center justify-between gap-2 text-[14px]"><span>{m.label}</span><StatusBadge status={m.status} /></li>)}</ul> : <p className="text-[14px] text-ink-mute">No Review 2 submission recorded.</p>}
              {c.from.submission && <p className="mt-2 text-[12.5px] text-ink-mute">Version {c.from.submission.version} · {fmtDateTime(c.from.submission.submittedAt)}</p>}
            </div>
            <div className="well p-4">
              <h4 className="mb-2 text-[14px] font-bold">Review 3 — latest recorded</h4>
              {c.to.submission ? <SubmissionData review={review} data={c.to.submission.data} /> : <p className="text-[14px] text-ink-mute">No Review 3 submission recorded.</p>}
            </div>
          </div>
        )}
      </Async>
    </Card>
  );
}
