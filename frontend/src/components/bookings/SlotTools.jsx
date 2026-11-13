import { Eye, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, Button, Card, StatusBadge, Tag } from "../ui/index.jsx";
import { Input, Select } from "../ui/fields.jsx";
import { api, describeError } from "../../lib/api.js";
import { fmtDate } from "../../lib/format.js";
import { toast } from "../../store/toast.js";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const STATE = { ok: ["success", "Will be created"], past: ["warning", "In the past"], duplicate: ["warning", "Already exists"], overlap: ["danger", "Overlaps a slot"] };

/** Manual slot or date-range generator with a server-side preview before anything is saved. */
export function SlotGenerator({ user, sections, guides, reviews, onCreated }) {
  const [f, setF] = useState({ mode: "range", reviewKey: reviews[0]?.key || "", guide: "", section: user.role === "coordinator" ? sections[0]?.id || "" : "", date: "", start: "10:00", end: "10:30", dateFrom: "", dateTo: "", durationMinutes: 30, gapMinutes: 0, weekdays: [1, 2, 3, 4, 5], windows: [{ start: "10:00", end: "13:00" }] });
  const [preview, setPreview] = useState(null);
  const [err, setErr] = useState({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [skip, setSkip] = useState(false);
  const set = (patch) => { setF((p) => ({ ...p, ...patch })); setPreview(null); };

  const body = () => {
    const b = { mode: f.mode, reviewKey: f.reviewKey, section: f.section || undefined, guide: user.role === "guide" ? undefined : f.guide || undefined };
    return f.mode === "manual" ? { ...b, date: f.date, start: f.start, end: f.end } : { ...b, dateFrom: f.dateFrom, dateTo: f.dateTo, weekdays: f.weekdays, windows: f.windows, durationMinutes: Number(f.durationMinutes), gapMinutes: Number(f.gapMinutes) };
  };
  const run = async (kind) => {
    setBusy(kind); setErr({}); setMsg("");
    try {
      if (kind === "preview") { const { data } = await api.post("/bookings/slots/preview", body()); setPreview(data); }
      else { const { data } = await api.post("/bookings/slots", { ...body(), skipConflicts: skip }); toast.success(`${data.created} slot(s) created${data.skipped ? `, ${data.skipped} skipped` : ""}.`); setPreview(null); onCreated(); }
    } catch (e) {
      const d = describeError(e); setMsg(d.message); setErr(d.fields || {});
      if (e.response?.data?.details?.slots) setPreview(e.response.data.details);
    } finally { setBusy(""); }
  };

  const needsGuide = user.role !== "guide";
  return (
    <Card>
      <h2 className="mb-1 text-[17px] font-bold">Create review slots</h2>
      <p className="mb-5 text-[13.5px] text-ink-mute">Add one slot, or generate many from a date range and time windows. You can preview before saving; nothing is created until you confirm.</p>
      {msg && <Alert tone="danger" className="mb-4">{msg}</Alert>}
      <div className="grid gap-4 md:grid-cols-3">
        <Select label="Review session" required value={f.reviewKey} onChange={(e) => set({ reviewKey: e.target.value })} error={err.reviewKey} options={reviews.map((r) => ({ value: r.key, label: r.name.split("—")[0].trim() + (r.type === "report" ? " (final report)" : "") }))} />
        {needsGuide && <Select label="Guide" required value={f.guide} onChange={(e) => set({ guide: e.target.value })} error={err.guide} placeholder="Choose guide" options={guides.map((g) => ({ value: g.id, label: g.name }))} />}
        {sections.length > 0 && <Select label={`Section${user.role === "coordinator" ? "" : " (optional)"}`} required={user.role === "coordinator"} value={f.section} onChange={(e) => set({ section: e.target.value })} placeholder={user.role === "coordinator" ? undefined : "Any of the guide's sections"} options={sections.map((s) => ({ value: s.id, label: `Section ${s.name}` }))} />}
      </div>

      <div className="well mt-5 inline-flex p-1" role="group" aria-label="Mode">
        {[["range", "Date range"], ["manual", "Single slot"]].map(([v, l]) => <button key={v} type="button" aria-pressed={f.mode === v} onClick={() => set({ mode: v })} className={`rounded-[11px] px-4 py-1.5 text-[14px] font-semibold ${f.mode === v ? "clay-sm text-slate-deep" : "text-ink-soft"}`}>{l}</button>)}
      </div>

      {f.mode === "manual" ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Input label="Date" type="date" required value={f.date} onChange={(e) => set({ date: e.target.value })} error={err.date} />
          <Input label="Start" type="time" required value={f.start} onChange={(e) => set({ start: e.target.value })} error={err.start} />
          <Input label="End" type="time" required value={f.end} onChange={(e) => set({ end: e.target.value })} error={err.end} />
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-4">
            <Input label="From date" type="date" required value={f.dateFrom} onChange={(e) => set({ dateFrom: e.target.value })} error={err.dateFrom} />
            <Input label="To date" type="date" required value={f.dateTo} onChange={(e) => set({ dateTo: e.target.value })} error={err.dateTo} />
            <Input label="Slot length (minutes)" type="number" min="5" required value={f.durationMinutes} onChange={(e) => set({ durationMinutes: e.target.value })} error={err.durationMinutes} />
            <Input label="Gap between slots (min)" type="number" min="0" value={f.gapMinutes} onChange={(e) => set({ gapMinutes: e.target.value })} />
          </div>
          <fieldset><legend className="label">Days</legend><div className="flex flex-wrap gap-2">{DAYS.map((d, i) => <label key={d} className={`cursor-pointer rounded-well px-3 py-1.5 text-[13.5px] font-semibold ${f.weekdays.includes(i) ? "clay-sm text-slate-deep" : "well text-ink-soft"}`}><input type="checkbox" className="sr-only" checked={f.weekdays.includes(i)} onChange={() => set({ weekdays: f.weekdays.includes(i) ? f.weekdays.filter((x) => x !== i) : [...f.weekdays, i] })} />{f.weekdays.includes(i) && "✓ "}{d}</label>)}</div></fieldset>
          <fieldset>
            <legend className="label">Time windows</legend>
            {err.windows && <p className="err mb-1">{err.windows}</p>}
            <div className="space-y-2">
              {f.windows.map((w, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <Input aria-label="Window start" type="time" value={w.start} onChange={(e) => set({ windows: f.windows.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)) })} />
                  <span className="text-ink-mute">to</span>
                  <Input aria-label="Window end" type="time" value={w.end} onChange={(e) => set({ windows: f.windows.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)) })} />
                  {f.windows.length > 1 && <Button variant="ghost" size="sm" aria-label="Remove window" onClick={() => set({ windows: f.windows.filter((_, j) => j !== i) })}><Trash2 size={15} /></Button>}
                </div>
              ))}
              {f.windows.length < 6 && <Button variant="soft" size="sm" onClick={() => set({ windows: [...f.windows, { start: "14:00", end: "16:00" }] })}><Plus size={14} />Add window</Button>}
            </div>
          </fieldset>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button variant="soft" loading={busy === "preview"} onClick={() => run("preview")}><Eye size={16} />Preview slots</Button>
        <Button loading={busy === "create"} disabled={!preview || preview.summary.ok === 0} onClick={() => run("create")}>Create {preview ? preview.summary.ok : ""} slot(s)</Button>
        {preview && preview.summary.ok < preview.summary.total && <label className="flex items-center gap-2 text-[13.5px] text-ink-soft"><input type="checkbox" className="accent-[#3F5F7A]" checked={skip} onChange={(e) => setSkip(e.target.checked)} />Skip the {preview.summary.total - preview.summary.ok} slot(s) with problems</label>}
      </div>

      {preview && (
        <div className="mt-5">
          <div className="mb-2 flex flex-wrap gap-2 text-[13px]"><Tag tone="success">{preview.summary.ok} ok</Tag>{preview.summary.duplicate > 0 && <Tag tone="warning">{preview.summary.duplicate} duplicate</Tag>}{preview.summary.overlap > 0 && <Tag tone="danger">{preview.summary.overlap} overlapping</Tag>}{preview.summary.past > 0 && <Tag tone="warning">{preview.summary.past} in the past</Tag>}</div>
          <div className="well max-h-72 overflow-y-auto p-3">
            <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {preview.slots.map((s, i) => <li key={i} className="flex items-center justify-between gap-2 rounded-well bg-white/50 px-3 py-1.5 text-[13px]"><span>{fmtDate(s.date)} {s.start}–{s.end}</span><StatusBadge status={s.state === "ok" ? "available" : s.state === "overlap" ? "rejected" : "changes_required"} label={STATE[s.state][1]} /></li>)}
            </ul>
          </div>
        </div>
      )}
    </Card>
  );
}

export function PolicyPanel({ user, sections, onChanged }) {
  const [sectionId, setSectionId] = useState(user.role === "coordinator" ? sections[0]?.id || "" : "");
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({});
  const load = async (sid) => { const { data: d } = await api.get("/bookings/policy", { params: sid ? { section: sid } : {} }); setData(d); setF({ enabled: sid ? (d.sectionOverride?.enabled ?? true) : d.college.enabled, requestBy: sid ? d.sectionOverride?.requestBy || d.policy.requestBy : d.college.requestBy, cutoffHoursBeforeSlot: sid ? d.sectionOverride?.cutoffHoursBeforeSlot ?? d.college.cutoffHoursBeforeSlot : d.college.cutoffHoursBeforeSlot, minDurationMinutes: d.college.minDurationMinutes, maxDurationMinutes: d.college.maxDurationMinutes, allowGuideSlotCreation: d.college.allowGuideSlotCreation }); };
  useEffect(() => { load(sectionId); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const collegeScope = !sectionId;
  const save = async () => {
    setBusy(true);
    try {
      const body = collegeScope ? { ...f, cutoffHoursBeforeSlot: Number(f.cutoffHoursBeforeSlot), minDurationMinutes: Number(f.minDurationMinutes), maxDurationMinutes: Number(f.maxDurationMinutes) } : { section: sectionId, enabled: f.enabled, requestBy: f.requestBy, cutoffHoursBeforeSlot: Number(f.cutoffHoursBeforeSlot) };
      await api.patch("/bookings/policy", body); toast.success("Booking policy saved."); await load(sectionId); onChanged();
    } catch (e) { toast.error(describeError(e).message); } finally { setBusy(false); }
  };
  if (!data) return <Card><p className="text-[14px] text-ink-mute">Loading policy…</p></Card>;
  const blockedByCollege = !collegeScope && !data.college.enabled;
  return (
    <Card>
      <h2 className="mb-1 text-[17px] font-bold">Booking policy</h2>
      <p className="mb-5 text-[13.5px] text-ink-mute">Slot booking is optional and independent of progress updates, feedback and report submission. Turning it off keeps all existing booking history.</p>
      {user.role === "hod" && <Select label="Applies to" value={sectionId} onChange={(e) => { setSectionId(e.target.value); load(e.target.value); }} className="mb-5 max-w-xs" options={[{ value: "", label: "Whole college" }, ...sections.map((s) => ({ value: s.id, label: `Section ${s.name}` }))]} />}
      {user.role === "coordinator" && sections.length > 1 && <Select label="Section" value={sectionId} onChange={(e) => { setSectionId(e.target.value); load(e.target.value); }} className="mb-5 max-w-xs" options={sections.map((s) => ({ value: s.id, label: `Section ${s.name}` }))} />}
      {blockedByCollege && <Alert tone="warning" className="mb-4">Booking is switched off college-wide by the HOD, so it cannot be enabled for a section.</Alert>}
      <div className="space-y-5">
        <label className="flex items-center gap-3"><input type="checkbox" className="h-5 w-5 accent-[#3F5F7A]" disabled={blockedByCollege} checked={Boolean(f.enabled) && !blockedByCollege} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /><span><span className="block font-semibold">Slot booking enabled {collegeScope ? "college-wide" : "for this section"}</span><span className="text-[13px] text-ink-mute">Currently {data.policy.enabled ? "ON" : "OFF"} for {collegeScope ? "the college" : "this section"}.</span></span></label>
        <div className="grid gap-4 sm:grid-cols-3">
          <Select label="Who may request" value={f.requestBy} onChange={(e) => setF({ ...f, requestBy: e.target.value })} options={[{ value: "any_member", label: "Any team member" }, { value: "leader", label: "Team leader only" }]} />
          <Input label="Request cut-off (hours before slot)" type="number" min="0" value={f.cutoffHoursBeforeSlot} onChange={(e) => setF({ ...f, cutoffHoursBeforeSlot: e.target.value })} help={collegeScope ? "0 = until the slot starts." : `Cannot be below the college value (${data.college.cutoffHoursBeforeSlot} h).`} />
          {collegeScope && <label className="flex items-center gap-2 self-end pb-2.5 text-[14px] font-semibold"><input type="checkbox" className="accent-[#3F5F7A]" checked={f.allowGuideSlotCreation} onChange={(e) => setF({ ...f, allowGuideSlotCreation: e.target.checked })} />Guides may create their own slots</label>}
        </div>
        {collegeScope && <div className="grid gap-4 sm:grid-cols-3"><Input label="Minimum slot length (min)" type="number" min="5" value={f.minDurationMinutes} onChange={(e) => setF({ ...f, minDurationMinutes: e.target.value })} /><Input label="Maximum slot length (min)" type="number" min="5" value={f.maxDurationMinutes} onChange={(e) => setF({ ...f, maxDurationMinutes: e.target.value })} /></div>}
        <Button loading={busy} onClick={save}>Save policy</Button>
      </div>
    </Card>
  );
}
