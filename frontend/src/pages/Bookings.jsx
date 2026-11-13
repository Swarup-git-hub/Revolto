import { CalendarClock, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { PolicyPanel, SlotGenerator } from "../components/bookings/SlotTools.jsx";
import { Alert, Async, Button, Card, ConfirmDialog, EmptyState, Modal, PageHeader, Pager, StatusBadge, Tabs } from "../components/ui/index.jsx";
import { Select, Textarea } from "../components/ui/fields.jsx";
import { api, describeError } from "../lib/api.js";
import { fmtDate } from "../lib/format.js";
import { useLoad } from "../lib/hooks.js";
import { useAuth } from "../store/auth.js";
import { toast } from "../store/toast.js";

const label = (k) => k.replace("-", " ").replace(/^./, (c) => c.toUpperCase());

function ReasonDialog({ open, onClose, title, required, confirmLabel, onSubmit, danger, children }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const go = async () => { setBusy(true); setErr(""); try { await onSubmit(reason); setReason(""); onClose(); } catch (e) { setErr(describeError(e).message); } finally { setBusy(false); } };
  return (
    <Modal open={open} onClose={onClose} title={title} footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button variant={danger ? "danger" : "primary"} loading={busy} onClick={go}>{confirmLabel}</Button></>}>
      <div className="space-y-4">{err && <Alert tone="danger">{err}</Alert>}{children}<Textarea label={required ? "Reason (required)" : "Reason (optional)"} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
    </Modal>
  );
}

/* ---------------- student ---------------- */
function StudentBookings({ user }) {
  const [tab, setTab] = useState("book");
  const [review, setReview] = useState("");
  const [pick, setPick] = useState(null);
  const [busy, setBusy] = useState(false);
  const policy = useLoad(() => api.get("/bookings/policy").then((r) => r.data.policy), []);
  const [slotPage, setSlotPage] = useState(1);
  const [reqPage, setReqPage] = useState(1);
  const SLOTS = 100, REQS = 25;
  const slots = useLoad(() => api.get("/bookings/slots", { params: { status: "available", reviewKey: review || undefined, page: slotPage, limit: SLOTS } }).then((r) => r.data), [review, slotPage]);
  const reqs = useLoad(() => api.get("/bookings/requests", { params: { page: reqPage, limit: REQS } }).then((r) => r.data), [reqPage]);
  const reviews = useLoad(() => api.get("/reviews/config").then((r) => r.data.reviews), []);
  const [cancel, setCancel] = useState(null);

  const request = async () => {
    setBusy(true);
    try { await api.post("/bookings/requests", { slotId: pick.id }); toast.success("Slot requested. Your guide will review it."); setPick(null); slots.reload(); reqs.reload(); setTab("mine"); }
    catch (e) { toast.error(describeError(e).message); setPick(null); slots.reload(); } finally { setBusy(false); }
  };
  if (!user.team) return <Card><EmptyState icon={CalendarClock} title="You need a team first" hint="Slots are booked per team." /></Card>;

  return (
    <>
      <Async state={policy} rows={1}>{(p) => !p.enabled && <Alert tone="warning" className="mb-5">Slot booking is currently switched off. You can still submit progress, receive feedback and submit your final report. Existing bookings stay visible below.</Alert>}</Async>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "book", label: "Available slots" }, { id: "mine", label: "My team's requests" }]} />
      {tab === "book" ? (
        <Card>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <Select aria-label="Review session" value={review} onChange={(e) => { setReview(e.target.value); setSlotPage(1); }} placeholder="All review sessions" className="w-64" options={(reviews.data || []).map((r) => ({ value: r.key, label: r.name.split("—")[0].trim() }))} />
          </div>
          <Async state={slots} rows={4} isEmpty={(d) => !d.slots.length} empty={<EmptyState icon={CalendarClock} title="No open slots" hint="Your guide has not published any available slots for this session yet." />}>
            {(d) => {
              const byDate = d.slots.reduce((m, s) => ((m[s.date] ||= []).push(s), m), {});
              return (<>{Object.entries(byDate).map(([date, items]) => (
                <div key={date} className="mb-5">
                  <h3 className="mb-2 text-[14px] font-bold text-ink-soft">{fmtDate(date)}</h3>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {items.map((s) => <button key={s.id} type="button" disabled={!policy.data?.enabled} className="btn-soft flex-col !items-start !gap-0.5 text-left" onClick={() => setPick(s)}><span className="text-[15px] font-bold">{s.start}–{s.end}</span><span className="text-[12px] font-normal text-ink-mute">{label(s.reviewKey)} · {s.guide.name}</span></button>)}
                  </div>
                </div>
              ))}<Pager page={slotPage} limit={SLOTS} total={d.total} onPage={setSlotPage} label="open slots" /></>);
            }}
          </Async>
        </Card>
      ) : (
        <Card>
          <Async state={reqs} rows={3} isEmpty={(d) => !d.requests.length} empty={<EmptyState title="No requests yet" hint="Choose an available slot to request it." />}>
            {(d) => <><ul className="space-y-2">{d.requests.map((r) => (
              <li key={r.id} className="well flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="text-[14.5px]"><strong>{label(r.reviewKey)}</strong> · {fmtDate(r.slot.date)} {r.slot.start}–{r.slot.end}<div className="text-[12.5px] text-ink-mute">Requested by {r.requestedBy.name}{r.decisionReason ? ` · ${r.decisionReason}` : ""}{r.overridden ? " · changed by coordinator/HOD" : ""}</div></div>
                <div className="flex items-center gap-2"><StatusBadge status={r.status} />{r.status === "pending" && <Button variant="soft" size="sm" onClick={() => setCancel(r)}>Cancel request</Button>}</div>
              </li>))}</ul><Pager page={reqPage} limit={REQS} total={d.total} onPage={setReqPage} label="requests" /></>}
          </Async>
        </Card>
      )}
      <ConfirmDialog open={Boolean(pick)} onClose={() => setPick(null)} loading={busy} title="Request this slot?" confirmLabel="Request slot" onConfirm={request}
        message={pick ? `${label(pick.reviewKey)} · ${fmtDate(pick.date)}, ${pick.start}–${pick.end} with ${pick.guide.name}. Your guide must approve it, and your team can hold one slot per review session.` : ""} />
      <ConfirmDialog open={Boolean(cancel)} onClose={() => setCancel(null)} title="Cancel this request?" confirmLabel="Cancel request" danger message="The slot becomes available to other teams again."
        onConfirm={async () => { try { await api.post(`/bookings/requests/${cancel.id}/cancel`, {}); toast.success("Request cancelled."); setCancel(null); reqs.reload(); slots.reload(); } catch (e) { toast.error(describeError(e).message); } }} />
    </>
  );
}

/* ---------------- staff: requests + slots ---------------- */
function StaffRequests({ user, reload }) {
  const [status, setStatus] = useState("pending");
  const [page, setPage] = useState(1);
  const PAGE = 25;
  const reqs = useLoad(() => api.get("/bookings/requests", { params: { ...(status ? { status } : {}), page, limit: PAGE } }).then((r) => r.data), [status, page]);
  const [dlg, setDlg] = useState(null);
  const slots = useLoad(() => (dlg?.kind === "reassign" ? api.get("/bookings/slots", { params: { status: "available", reviewKey: dlg.r.reviewKey, guide: dlg.r.guide.id, limit: 200 } }).then((r) => r.data.slots) : Promise.resolve([])), [dlg?.r?.id, dlg?.kind]);
  const [slotId, setSlotId] = useState("");
  const [oAction, setOAction] = useState("approve");
  const done = (m) => { toast.success(m); reqs.reload(); reload(); };
  const isGuide = user.role === "guide";

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-end gap-3"><Select aria-label="Status filter" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-52" options={[{ value: "pending", label: "Pending approval" }, { value: "approved", label: "Approved" }, { value: "rejected", label: "Rejected" }, { value: "cancelled", label: "Cancelled" }, { value: "", label: "All" }]} /></div>
      <Async state={reqs} rows={3} isEmpty={(d) => !d.requests.length} empty={<EmptyState icon={CalendarClock} title="No requests" hint="Nothing matches this filter." />}>
        {(d) => <><ul className="space-y-2">{d.requests.map((r) => (
          <li key={r.id} className="well flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="text-[14.5px]"><strong>{r.team.teamId}</strong> · {label(r.reviewKey)} · {fmtDate(r.slot.date)} {r.slot.start}–{r.slot.end}
              <div className="text-[12.5px] text-ink-mute">{r.guide.name} · requested by {r.requestedBy.name}{r.overridden ? " · overridden" : ""}{r.decisionReason ? ` · ${r.decisionReason}` : ""}</div></div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={r.status} />
              {isGuide && r.status === "pending" && <><Button size="sm" onClick={() => setDlg({ kind: "approve", r })}>Approve</Button><Button size="sm" variant="soft" onClick={() => setDlg({ kind: "reject", r })}>Reject</Button></>}
              {isGuide && r.status === "approved" && <Button size="sm" variant="soft" onClick={() => setDlg({ kind: "cancel", r })}>Cancel</Button>}
              {!isGuide && ["pending", "approved"].includes(r.status) && <Button size="sm" variant="soft" onClick={() => { setOAction(r.status === "pending" ? "approve" : "cancel"); setSlotId(""); setDlg({ kind: "override", r }); }}>Override…</Button>}
            </div>
          </li>))}</ul><Pager page={page} limit={PAGE} total={d.total} onPage={setPage} label="requests" /></>}
      </Async>

      <ConfirmDialog open={dlg?.kind === "approve"} onClose={() => setDlg(null)} title="Approve this booking?" confirmLabel="Approve" message={dlg ? `${dlg.r.team.teamId} · ${fmtDate(dlg.r.slot.date)} ${dlg.r.slot.start}–${dlg.r.slot.end}. The team is notified.` : ""} onConfirm={async () => { try { await api.post(`/bookings/requests/${dlg.r.id}/approve`, {}); setDlg(null); done("Booking approved."); } catch (e) { toast.error(describeError(e).message); } }} />
      <ReasonDialog open={dlg?.kind === "reject"} onClose={() => setDlg(null)} title="Reject request" required danger confirmLabel="Reject" onSubmit={async (reason) => { await api.post(`/bookings/requests/${dlg.r.id}/reject`, { reason }); done("Request rejected."); }}><p className="text-[14px] text-ink-soft">The slot is released and the team can request another one.</p></ReasonDialog>
      <ReasonDialog open={dlg?.kind === "cancel"} onClose={() => setDlg(null)} title="Cancel approved booking" required danger confirmLabel="Cancel booking" onSubmit={async (reason) => { await api.post(`/bookings/requests/${dlg.r.id}/cancel`, { reason }); done("Booking cancelled."); }} />
      <ReasonDialog open={dlg?.kind === "override"} onClose={() => setDlg(null)} title="Override booking" required confirmLabel="Apply override"
        onSubmit={async (reason) => { await api.post(`/bookings/requests/${dlg.r.id}/override`, { action: oAction, reason, slotId: oAction === "reassign" ? slotId : undefined }); done("Override applied and recorded in the audit log."); }}>
        <Alert tone="warning">Overrides bypass the guide's normal approval. Your name, the reason and the before/after values are recorded.</Alert>
        <Select label="Action" value={oAction} onChange={(e) => setOAction(e.target.value)} options={[...(dlg?.r.status === "pending" ? [{ value: "approve", label: "Approve" }, { value: "reject", label: "Reject" }] : []), { value: "reassign", label: "Move to another slot" }, { value: "cancel", label: "Cancel booking" }]} />
        {oAction === "reassign" && <Async state={slots} rows={1} isEmpty={(d) => !d.length} empty={<p className="text-[13.5px] text-ink-mute">No free slots for this guide and session.</p>}>{(s) => <Select label="New slot" value={slotId} onChange={(e) => setSlotId(e.target.value)} placeholder="Choose a slot" options={s.map((x) => ({ value: x.id, label: `${fmtDate(x.date)} ${x.start}–${x.end}` }))} />}</Async>}
      </ReasonDialog>
    </Card>
  );
}

function SlotList({ refreshKey, reload }) {
  const [page, setPage] = useState(1);
  const PAGE = 50;
  const state = useLoad(() => api.get("/bookings/slots", { params: { page, limit: PAGE } }).then((r) => r.data), [refreshKey, page]);
  useEffect(() => { if (state.data && !state.data.slots.length && page > 1) setPage(Math.max(1, Math.ceil(state.data.total / PAGE))); }, [state.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const [dlg, setDlg] = useState(null);
  const run = async (fn, m) => { try { await fn(); toast.success(m); setDlg(null); state.reload(); reload(); } catch (e) { toast.error(describeError(e).message); } };
  return (
    <Card>
      <h2 className="mb-3 text-[17px] font-bold">Slots</h2>
      <Async state={state} rows={3} isEmpty={(d) => !d.slots.length} empty={<EmptyState icon={CalendarClock} title="No slots yet" hint="Create slots above." />}>
        {(d) => <div className="overflow-x-auto"><table className="w-full text-[14px]"><thead><tr><th className="th">Date</th><th className="th">Time</th><th className="th">Review</th><th className="th">Guide</th><th className="th">Status</th><th className="th" /></tr></thead><tbody>
          {d.slots.map((s) => <tr key={s.id} className="border-t border-white/70"><td className="td">{fmtDate(s.date)}</td><td className="td">{s.start}–{s.end}</td><td className="td">{label(s.reviewKey)}{s.section && <span className="text-ink-mute"> · {s.section.name}</span>}</td><td className="td">{s.guide.name}</td><td className="td"><StatusBadge status={s.status} />{s.bookedTeam && <span className="ml-2 text-[12.5px] text-ink-mute">{s.bookedTeam.teamId}</span>}</td>
            <td className="td text-right">{s.status === "available" && <><Button variant="ghost" size="sm" onClick={() => setDlg({ kind: "disable", s })}>Disable</Button><Button variant="ghost" size="sm" aria-label="Delete slot" onClick={() => setDlg({ kind: "delete", s })}><Trash2 size={15} /></Button></>}{s.status === "disabled" && <Button variant="ghost" size="sm" onClick={() => run(() => api.patch(`/bookings/slots/${s.id}`, { action: "enable" }), "Slot enabled.")}>Enable</Button>}</td></tr>)}
        </tbody></table><Pager page={page} limit={PAGE} total={d.total} onPage={setPage} label="slots" /></div>}
      </Async>
      <ConfirmDialog open={dlg?.kind === "disable"} onClose={() => setDlg(null)} title="Disable this slot?" confirmLabel="Disable" message="Teams will no longer see it. You can enable it again later." onConfirm={() => run(() => api.patch(`/bookings/slots/${dlg.s.id}`, { action: "disable" }), "Slot disabled.")} />
      <ConfirmDialog open={dlg?.kind === "delete"} onClose={() => setDlg(null)} danger title="Delete this slot?" confirmLabel="Delete" message="Only slots that never had a booking request can be deleted; otherwise disable it." onConfirm={() => run(() => api.delete(`/bookings/slots/${dlg.s.id}`), "Slot deleted.")} />
    </Card>
  );
}

function StaffBookings({ user }) {
  const [tab, setTab] = useState("requests");
  const [n, setN] = useState(0);
  const bump = () => setN((x) => x + 1);
  const sections = useLoad(() => (user.role === "guide" ? Promise.resolve([]) : api.get("/sections").then((r) => r.data.sections)), []);
  const guides = useLoad(() => (user.role === "guide" ? Promise.resolve([]) : api.get("/users/guides").then((r) => r.data.guides)), []);
  const reviews = useLoad(() => api.get("/reviews/config").then((r) => r.data.reviews), []);
  const policy = useLoad(() => api.get("/bookings/policy").then((r) => r.data.policy), [n]);
  const tabs = [{ id: "requests", label: "Requests" }, { id: "slots", label: "Slots" }, ...(user.role === "guide" ? [] : [{ id: "policy", label: "Policy" }])];
  return (
    <>
      <Async state={policy} rows={1}>{(p) => !p.enabled && <Alert tone="warning" className="mb-5">Slot booking is currently switched off. Teams can still submit progress and reports. Existing bookings remain visible.</Alert>}</Async>
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === "requests" && <StaffRequests user={user} reload={bump} />}
      {tab === "slots" && (
        <div className="space-y-6">
          <Async state={reviews} rows={2}>{(rv) => <Async state={sections} rows={1}>{(sec) => <Async state={guides} rows={1}>{(gd) => <SlotGenerator user={user} sections={sec} guides={gd} reviews={rv} onCreated={bump} />}</Async>}</Async>}</Async>
          <SlotList refreshKey={n} reload={bump} />
        </div>
      )}
      {tab === "policy" && <Async state={sections} rows={1}>{(sec) => <PolicyPanel user={user} sections={sec} onChanged={bump} />}</Async>}
    </>
  );
}

export default function Bookings() {
  const user = useAuth((s) => s.user);
  return (
    <div className="rise">
      <PageHeader title={user.role === "student" ? "Review slots" : "Slots & bookings"} subtitle="Optional scheduling for review sessions. It never blocks progress updates, feedback or report submission." />
      {user.role === "student" ? <StudentBookings user={user} /> : <StaffBookings user={user} />}
    </div>
  );
}
