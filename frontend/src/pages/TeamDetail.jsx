import { Archive, ArrowLeft, Crown, Pencil, RotateCcw, UserMinus, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import ProgressSummary from "../components/reviews/ProgressSummary.jsx";
import ReviewPanel from "../components/reviews/ReviewPanel.jsx";
import { Alert, Async, Button, Card, ConfirmDialog, EmptyState, Modal, StatusBadge, Tabs } from "../components/ui/index.jsx";
import { Input, Select, Textarea } from "../components/ui/fields.jsx";
import { api, describeError } from "../lib/api.js";
import { fmtDate, fmtDateTime } from "../lib/format.js";
import { useLoad } from "../lib/hooks.js";
import { useAuth } from "../store/auth.js";
import { toast } from "../store/toast.js";

function TitleDialog({ open, onClose, team, onSaved }) {
  const [f, setF] = useState({ projectTitle: "", reason: "" });
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setF({ projectTitle: team.projectTitle, reason: "" }); setErr({}); } }, [open]); // eslint-disable-line
  const save = async () => {
    setBusy(true); setErr({});
    try { await api.patch(`/teams/${team.id}/title`, f); toast.success("Title updated and recorded in the history."); onSaved(); onClose(); }
    catch (e) { const d = describeError(e); setErr({ message: d.message, ...d.fields }); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Change project title" footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save change</Button></>}>
      <div className="space-y-4">
        {err.message && !err.projectTitle && !err.reason && <Alert tone="danger">{err.message}</Alert>}
        <Input label="New title" required value={f.projectTitle} error={err.projectTitle} onChange={(e) => setF({ ...f, projectTitle: e.target.value })} />
        <Textarea label="Reason for the change" required rows={3} value={f.reason} error={err.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} help="Recorded with the old title, new title, your name and the time. The team is notified." />
      </div>
    </Modal>
  );
}

function AddMemberDialog({ open, onClose, team, onSaved }) {
  const [sel, setSel] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const list = useLoad(() => (open ? api.get(`/users/available-students?section=${team.section.id}`).then((r) => r.data.users) : Promise.resolve([])), [open, team.id]);
  const save = async () => {
    setBusy(true); setMsg("");
    try { await api.post(`/teams/${team.id}/members`, { studentId: sel }); toast.success("Member added."); setSel(""); onSaved(); onClose(); } catch (e) { setMsg(describeError(e).message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Add a member" footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!sel} onClick={save}>Add to team</Button></>}>
      {msg && <Alert tone="danger" className="mb-3">{msg}</Alert>}
      <Async state={list} rows={2} isEmpty={(d) => !d.length} empty={<p className="text-[14px] text-ink-mute">No students without a team in section {team.section.name}.</p>}>
        {(users) => <Select label={`Students in section ${team.section.name} without a team`} value={sel} onChange={(e) => setSel(e.target.value)} placeholder="Choose a student" options={users.map((u) => ({ value: u.id, label: `${u.rollNumber} · ${u.name}` }))} />}
      </Async>
    </Modal>
  );
}

function GuideDialog({ open, onClose, team, onSaved }) {
  const [guide, setGuide] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const guides = useLoad(() => (open ? api.get("/users/guides").then((r) => r.data.guides) : Promise.resolve([])), [open]);
  const save = async () => {
    setBusy(true); setMsg("");
    try { await api.patch(`/teams/${team.id}`, { guide }); toast.success("Guide reassigned."); onSaved(); onClose(); } catch (e) { setMsg(describeError(e).message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Change guide" footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!guide} onClick={save}>Reassign</Button></>}>
      {msg && <Alert tone="danger" className="mb-3">{msg}</Alert>}
      <Async state={guides} rows={1}>{(g) => <Select label="Guide" value={guide} onChange={(e) => setGuide(e.target.value)} placeholder="Choose a guide" options={g.filter((x) => x.id !== team.guide.id).map((x) => ({ value: x.id, label: `${x.name} (${x.teamCount} teams)` }))} />}</Async>
    </Modal>
  );
}

function TeamBookings({ team }) {
  const state = useLoad(() => api.get(`/bookings/requests?team=${team.id}`).then((r) => r.data.requests), [team.id]);
  return (
    <Card>
      <h2 className="mb-3 text-[16px] font-bold">Review slot bookings</h2>
      <Async state={state} rows={2} isEmpty={(d) => !d.length} empty={<EmptyState title="No bookings" hint="Slot requests made for this team appear here, including past ones." />}>
        {(list) => <ul className="space-y-2">{list.map((r) => <li key={r.id} className="well flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[14px]"><span><strong>{r.reviewKey.replace("-", " ")}</strong> · {r.slot.date ? `${fmtDate(r.slot.date)} ${r.slot.start}–${r.slot.end}` : ""}{r.overridden && <span className="ml-2 text-[12px] font-semibold text-amber-ink">(changed by coordinator/HOD)</span>}</span><StatusBadge status={r.status} /></li>)}</ul>}
      </Async>
    </Card>
  );
}

export default function TeamDetail({ teamId }) {
  const params = useParams();
  const id = teamId || params.id;
  const user = useAuth((s) => s.user);
  const [sp, setSp] = useSearchParams();
  const [tab, setTab] = useState(sp.get("review") || "overview");
  const [dlg, setDlg] = useState(null);
  const [replacement, setReplacement] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setReplacement(""), [dlg]);
  const state = useLoad(() => api.get(`/teams/${id}`).then((r) => r.data.team), [id]);
  const sectionId = state.data?.section.id;
  const reviews = useLoad(() => (sectionId ? api.get("/reviews/config", { params: { section: sectionId } }).then((r) => r.data.reviews) : Promise.resolve([])), [sectionId]);
  const selectTab = (t) => { setTab(t); setSp(t === "overview" ? {} : { review: t }, { replace: true }); };

  const isManager = user.role === "hod" || (user.role === "coordinator");
  const isGuide = user.role === "guide";
  const act = async (fn, okMsg) => { setBusy(true); try { await fn(); toast.success(okMsg); state.reload(); setDlg(null); } catch (e) { toast.error(describeError(e).message); } finally { setBusy(false); } };

  return (
    <div className="rise">
      {user.role !== "student" && <Link to="/teams" className="mb-3 inline-flex items-center gap-1.5 text-[14px] font-semibold text-slate-brand"><ArrowLeft size={16} />All teams</Link>}
      <Async state={state} rows={5}>
        {(t) => {
          const reviewTabs = (reviews.data || []).map((r) => ({ id: r.key, label: r.type === "report" ? "Final report" : `Review ${r.order}`, badge: undefined }));
          const activeReview = (reviews.data || []).find((r) => r.key === tab);
          return (
            <>
              <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-[13px] font-semibold text-ink-mute">Team {t.teamId} · Section {t.section.name} · Guide: {t.guide.name}{t.status === "archived" && " · Archived"}</div>
                  <h1 className="mt-1 text-[26px] font-bold leading-tight">{t.projectTitle || "Project title not submitted yet"}</h1>
                  <div className="mt-2 flex flex-wrap items-center gap-2"><StatusBadge status={t.titleStatus} label={`Title: ${t.titleStatus.replace("_", " ")}`} />{t.belowMinSize && <StatusBadge status="changes_required" label={`Below minimum team size (${t.limits.minSize})`} />}</div>
                </div>
                {(isManager || isGuide) && t.status === "active" && (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="soft" size="sm" onClick={() => setDlg("title")}><Pencil size={14} />Edit title</Button>
                    {isGuide && t.projectTitle && t.titleStatus !== "confirmed" && <Button size="sm" loading={busy} onClick={() => act(() => api.post(`/teams/${t.id}/title/confirm`), "Title confirmed.")}>Confirm title</Button>}
                  </div>
                )}
              </header>

              <Tabs value={tab} onChange={selectTab} tabs={[{ id: "overview", label: "Overview" }, ...reviewTabs, { id: "bookings", label: "Bookings" }]} />

              {tab === "overview" && (
                <div className="space-y-6">
                  {t.progress && <ProgressSummary progress={t.progress} onSelect={selectTab} />}
                  <div className="grid gap-5 lg:grid-cols-2">
                    <Card>
                      <div className="mb-3 flex items-center justify-between"><h2 className="text-[16px] font-bold">Members ({t.memberCount})</h2>{(isManager || isGuide) && t.status === "active" && <Button variant="soft" size="sm" onClick={() => setDlg("add")}><UserPlus size={15} />Add member</Button>}</div>
                      <ul className="space-y-2">
                        {t.members.map((m) => (
                          <li key={m.id} className="well flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                            <span className="text-[14.5px] font-semibold">{m.name} <span className="text-[12.5px] font-normal text-ink-mute">{m.rollNumber}</span>{m.isLeader && <span className="ml-2 inline-flex items-center gap-1 text-[12px] font-semibold text-slate-deep"><Crown size={13} />Leader</span>}</span>
                            <span className="flex items-center gap-2">
                              <StatusBadge status={m.contributionStatus} />
                              {(isManager || isGuide) && t.status === "active" && (
                                <>
                                  {!m.isLeader && <Button variant="ghost" size="sm" aria-label={`Make ${m.name} leader`} title="Make team leader" onClick={() => act(() => api.patch(`/teams/${t.id}`, { leader: m.id }), "Leader changed.")}><Crown size={15} /></Button>}
                                  <Button variant="ghost" size="sm" aria-label={`Remove ${m.name}`} title="Remove from team" onClick={() => setDlg({ remove: m })}><UserMinus size={15} /></Button>
                                </>
                              )}
                            </span>
                          </li>
                        ))}
                        {!t.members.length && <li className="text-[14px] text-ink-mute">No members yet.</li>}
                      </ul>
                    </Card>
                    <Card>
                      <h2 className="mb-3 text-[16px] font-bold">Project title history</h2>
                      {t.titleHistory.length ? (
                        <ul className="space-y-3">{[...t.titleHistory].reverse().map((h, i) => (
                          <li key={i} className="well px-4 py-3 text-[13.5px]"><div><span className="text-ink-mute line-through">{h.oldTitle}</span> → <strong>{h.newTitle}</strong></div><div className="mt-1 text-ink-mute">{h.actorName} · {fmtDateTime(h.at)}</div>{h.reason && <div className="text-ink-soft">Reason: {h.reason}</div>}</li>
                        ))}</ul>
                      ) : <p className="text-[14px] text-ink-mute">The title has not been changed.</p>}
                      {isManager && (
                        <div className="mt-5 flex flex-wrap gap-2 border-t border-white/70 pt-4">
                          <Button variant="soft" size="sm" onClick={() => setDlg("guide")}>Change guide</Button>
                          {t.status === "active" ? <Button variant="soft" size="sm" onClick={() => setDlg("archive")}><Archive size={14} />Archive team</Button> : <Button variant="soft" size="sm" onClick={() => act(() => api.post(`/teams/${t.id}/restore`), "Team restored.")}><RotateCcw size={14} />Restore team</Button>}
                        </div>
                      )}
                    </Card>
                  </div>
                </div>
              )}

              {activeReview && <ReviewPanel key={activeReview.key} team={t} review={activeReview} user={user} onChanged={state.reload} />}
              {tab === "bookings" && <TeamBookings team={t} />}

              <TitleDialog open={dlg === "title"} onClose={() => setDlg(null)} team={t} onSaved={state.reload} />
              <AddMemberDialog open={dlg === "add"} onClose={() => setDlg(null)} team={t} onSaved={state.reload} />
              <GuideDialog open={dlg === "guide"} onClose={() => setDlg(null)} team={t} onSaved={state.reload} />
              {(() => {
                const leaving = dlg?.remove;
                const candidates = leaving ? t.members.filter((m) => m.id !== leaving.id) : [];
                const needsReplacement = Boolean(leaving?.isLeader);
                const blocked = needsReplacement && candidates.length === 0;
                return (
                  <ConfirmDialog open={Boolean(leaving)} onClose={() => setDlg(null)} danger loading={busy} title="Remove from team?" confirmLabel="Remove"
                    confirmDisabled={blocked || (needsReplacement && !replacement)}
                    message={leaving ? `${leaving.name} will no longer be part of ${t.teamId}. Their recorded contributions stay in the history.` : ""}
                    onConfirm={() => act(() => api.delete(`/teams/${t.id}/members/${leaving.id}`, { params: needsReplacement ? { replacementLeaderId: replacement } : {} }), "Member removed.")}>
                    {needsReplacement && (
                      <div className="mt-4">
                        {blocked ? <Alert tone="warning">{leaving.name} is the team leader and the only member. Add another member first, or archive the team.</Alert> : (
                          <Select label="New team leader" required value={replacement} onChange={(e) => setReplacement(e.target.value)} placeholder="Choose the new leader" options={candidates.map((m) => ({ value: m.id, label: `${m.name} (${m.rollNumber})` }))} help={`${leaving.name} is the current team leader, so someone must take over before they can be removed.`} />
                        )}
                      </div>
                    )}
                  </ConfirmDialog>
                );
              })()}
              <ConfirmDialog open={dlg === "archive"} onClose={() => setDlg(null)} danger loading={busy} title="Archive this team?" confirmLabel="Archive" message="The team can no longer submit or book slots. All submissions and feedback are kept, and the team can be restored." onConfirm={() => act(() => api.post(`/teams/${t.id}/archive`, {}), "Team archived.")} />
            </>
          );
        }}
      </Async>
    </div>
  );
}
