import { ClipboardCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { Async, Card, EmptyState, PageHeader, StatusBadge } from "../components/ui/index.jsx";
import { api } from "../lib/api.js";
import { fmtDateTime } from "../lib/format.js";
import { useLoad } from "../lib/hooks.js";

export default function ReviewQueue() {
  const state = useLoad(() => api.get("/reviews/queue").then((r) => r.data), []);
  const row = (key, to, left, right) => (
    <li key={key}><Link to={to} className="well row-link flex flex-wrap items-center justify-between gap-3 px-4 py-3"><span className="text-[14.5px]">{left}</span><span className="flex items-center gap-3 text-[13px] text-ink-mute">{right}</span></Link></li>
  );
  return (
    <div className="rise">
      <PageHeader title="Review queue" subtitle="Work waiting for your decision, oldest first." />
      <Async state={state} rows={4} isEmpty={(d) => !d.submissions.length && !d.contributions.length && !d.awaitingCorrection.length} empty={<Card><EmptyState icon={ClipboardCheck} title="You are all caught up" hint="New submissions from your teams will appear here." /></Card>}>
        {(d) => (
          <div className="space-y-6">
            <Card>
              <h2 className="mb-3 text-[16px] font-bold">Submissions to review ({d.submissions.length})</h2>
              {d.submissions.length ? <ul className="space-y-2">{d.submissions.map((s) => row(s.id, `/teams/${s.team.id}?review=${s.reviewKey}`, <><strong>{s.team.teamId}</strong> · {s.reviewKey.replace("-", " ")} · v{s.version}</>, <><StatusBadge status={s.status} />{fmtDateTime(s.submittedAt)}</>))}</ul> : <p className="text-[14px] text-ink-mute">Nothing waiting.</p>}
            </Card>
            <Card>
              <h2 className="mb-3 text-[16px] font-bold">Contributions pending acknowledgement ({d.contributions.length})</h2>
              {d.contributions.length ? <ul className="space-y-2">{d.contributions.map((c) => row(c.id, `/teams/${c.team.id}?review=${c.reviewKey}`, <><strong>{c.student.name}</strong> · {c.team.teamId}</>, <><StatusBadge status="pending_review" />{fmtDateTime(c.submittedAt)}</>))}</ul> : <p className="text-[14px] text-ink-mute">Nothing waiting.</p>}
            </Card>
            <Card>
              <h2 className="mb-1 text-[16px] font-bold">Waiting for team corrections ({d.awaitingCorrection.length})</h2>
              <p className="mb-3 text-[13px] text-ink-mute">You asked for changes; the team leader has not resubmitted yet.</p>
              {d.awaitingCorrection.length ? <ul className="space-y-2">{d.awaitingCorrection.map((s) => row(s.id, `/teams/${s.team.id}?review=${s.reviewKey}`, <><strong>{s.team.teamId}</strong> · {s.reviewKey.replace("-", " ")} · v{s.version}</>, <StatusBadge status="changes_required" />))}</ul> : <p className="text-[14px] text-ink-mute">None.</p>}
            </Card>
          </div>
        )}
      </Async>
    </div>
  );
}
