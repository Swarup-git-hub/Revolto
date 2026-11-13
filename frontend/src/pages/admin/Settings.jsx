import { useEffect, useState } from "react";
import { Alert, Async, Button, Card, PageHeader } from "../../components/ui/index.jsx";
import { Input, Toggle } from "../../components/ui/fields.jsx";
import { api, describeError } from "../../lib/api.js";
import { useLoad } from "../../lib/hooks.js";
import { toast } from "../../store/toast.js";

const TYPES = ["pdf", "docx", "pptx", "xlsx", "zip", "png", "jpg"];

function Form({ settings, onSaved }) {
  const [f, setF] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setF({ minSize: settings.team.minSize, maxSize: settings.team.maxSize, maxTeams: settings.guide.maxTeams, defaultCapacity: settings.section.defaultCapacity ?? "", reconf: settings.reviews.requireTitleReconfirmation, types: settings.uploads.defaultAcceptedTypes, size: settings.uploads.defaultMaxSizeMB, name: settings.college.name, tz: settings.college.timezoneOffsetMinutes }); }, [settings]);
  if (!f) return null;
  const save = async () => {
    setBusy(true); setMsg("");
    try {
      await api.patch("/settings", { team: { minSize: Number(f.minSize), maxSize: Number(f.maxSize) }, guide: { maxTeams: Number(f.maxTeams) }, section: { defaultCapacity: f.defaultCapacity === "" ? null : Number(f.defaultCapacity) }, reviews: { requireTitleReconfirmation: f.reconf }, uploads: { defaultAcceptedTypes: f.types, defaultMaxSizeMB: Number(f.size) }, college: { name: f.name, timezoneOffsetMinutes: Number(f.tz) } });
      toast.success("Settings saved."); onSaved();
    } catch (e) { setMsg(describeError(e).message); } finally { setBusy(false); }
  };
  const num = (k) => ({ value: f[k], onChange: (e) => setF({ ...f, [k]: e.target.value }) });
  return (
    <div className="space-y-6">
      {msg && <Alert tone="danger">{msg}</Alert>}
      <Card><h2 className="mb-4 text-[16px] font-bold">Teams and workload</h2><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Input label="Minimum team size" type="number" min="1" {...num("minSize")} /><Input label="Maximum team size" type="number" min="1" {...num("maxSize")} /><Input label="Teams per guide (maximum)" type="number" min="1" {...num("maxTeams")} /><Input label="Default section capacity" type="number" min="1" {...num("defaultCapacity")} help="Empty = unlimited. Sections can override." /></div></Card>
      <Card><h2 className="mb-4 text-[16px] font-bold">Reviews</h2><Toggle checked={f.reconf} onChange={(v) => setF({ ...f, reconf: v })} label="Require title reconfirmation" hint="After a guide edits an already confirmed project title, it returns to “submitted” until the guide confirms it again." /></Card>
      <Card><h2 className="mb-4 text-[16px] font-bold">File uploads (defaults)</h2>
        <div className="flex flex-wrap gap-2">{TYPES.map((t) => <label key={t} className={`cursor-pointer rounded-well px-3 py-1.5 text-[13.5px] font-semibold uppercase ${f.types.includes(t) ? "clay-sm text-slate-deep" : "well text-ink-soft"}`}><input type="checkbox" className="sr-only" checked={f.types.includes(t)} onChange={() => setF({ ...f, types: f.types.includes(t) ? f.types.filter((x) => x !== t) : [...f.types, t] })} />{f.types.includes(t) && "✓ "}{t}</label>)}</div>
        <Input className="mt-4 max-w-xs" label="Maximum file size (MB, up to 25)" type="number" min="1" max="25" {...num("size")} />
        <p className="help">Each review can override these in Review setup. File contents are checked against the selected type.</p></Card>
      <Card><h2 className="mb-4 text-[16px] font-bold">College</h2><div className="grid gap-4 sm:grid-cols-2"><Input label="College name" {...num("name")} /><Input label="Time zone offset (minutes from UTC)" type="number" {...num("tz")} help="330 = India Standard Time. Used for slot dates and cut-offs." /></div></Card>
      <p className="text-[13px] text-ink-mute">Slot booking is configured separately under Slots &amp; bookings → Policy.</p>
      <Button loading={busy} onClick={save}>Save settings</Button>
    </div>
  );
}

export default function SettingsPage() {
  const state = useLoad(() => api.get("/settings").then((r) => r.data.settings), []);
  return <div className="rise"><PageHeader title="Settings" subtitle="College-wide limits and defaults. Changes are recorded in the audit log." /><Async state={state} rows={4}>{(s) => <Form settings={s} onSaved={state.reload} />}</Async></div>;
}
