import { Plus } from "lucide-react";
import { useState } from "react";
import { Alert, Async, Button, Card, EmptyState, Modal, PageHeader, StatusBadge } from "../../components/ui/index.jsx";
import { Input } from "../../components/ui/fields.jsx";
import { api, describeError } from "../../lib/api.js";
import { useLoad } from "../../lib/hooks.js";
import { toast } from "../../store/toast.js";

export default function Sections() {
  const state = useLoad(() => api.get("/sections", { params: { includeArchived: true } }).then((r) => r.data.sections), []);
  const coords = useLoad(() => api.get("/users", { params: { role: "coordinator", limit: 200 } }).then((r) => r.data.users), []);
  const [dlg, setDlg] = useState(null);
  const [f, setF] = useState({ name: "", capacity: "" });
  const [sel, setSel] = useState([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const open = (kind, s) => { setDlg({ kind, s }); setMsg(""); setF({ name: s?.name || "", capacity: s?.capacity ?? "" }); setSel(s?.coordinators?.map((c) => c.id) || []); };
  const run = async (fn, m) => { setBusy(true); setMsg(""); try { await fn(); toast.success(m); setDlg(null); state.reload(); coords.reload(); } catch (e) { setMsg(describeError(e).message); } finally { setBusy(false); } };

  return (
    <div className="rise">
      <PageHeader title="Sections" subtitle="Sections group students and teams. Capacity limits and coordinator assignments are managed here." actions={<Button onClick={() => open("edit")}><Plus size={16} />New section</Button>} />
      <Async state={state} rows={3} isEmpty={(d) => !d.length} empty={<Card><EmptyState title="No sections yet" hint="Create a section such as “A” before adding students." /></Card>}>
        {(list) => (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {list.map((s) => (
              <Card key={s.id}>
                <div className="flex items-start justify-between gap-2"><h2 className="text-[20px] font-bold">Section {s.name}</h2>{!s.isActive && <StatusBadge status="cancelled" label="Archived" />}</div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                  {[["Students", `${s.studentCount ?? 0}${s.effectiveCapacity ? ` / ${s.effectiveCapacity}` : ""}`], ["Teams", s.teamCount ?? 0], ["Booking", s.booking?.enabled === false ? "Off" : "Default"]].map(([k, v]) => <div key={k} className="well py-2.5"><dd className="text-[17px] font-bold">{v}</dd><dt className="text-[12px] text-ink-mute">{k}</dt></div>)}
                </dl>
                <p className="mt-3 text-[13.5px] text-ink-soft"><span className="font-semibold">Coordinators:</span> {s.coordinators?.length ? s.coordinators.map((c) => c.name).join(", ") : "none assigned"}</p>
                <div className="mt-4 flex flex-wrap gap-2"><Button variant="soft" size="sm" onClick={() => open("edit", s)}>Edit</Button><Button variant="soft" size="sm" onClick={() => open("coord", s)}>Coordinators</Button><Button variant="ghost" size="sm" onClick={() => run(() => api.patch(`/sections/${s.id}`, { isActive: !s.isActive }), s.isActive ? "Section archived." : "Section restored.")}>{s.isActive ? "Archive" : "Restore"}</Button></div>
              </Card>
            ))}
          </div>
        )}
      </Async>

      <Modal open={dlg?.kind === "edit"} onClose={() => setDlg(null)} title={dlg?.s ? `Edit section ${dlg.s.name}` : "New section"} footer={<><Button variant="soft" onClick={() => setDlg(null)}>Cancel</Button><Button loading={busy} onClick={() => run(() => (dlg.s ? api.patch(`/sections/${dlg.s.id}`, { name: f.name, capacity: f.capacity === "" ? null : Number(f.capacity) }) : api.post("/sections", { name: f.name, capacity: f.capacity === "" ? undefined : Number(f.capacity) })), "Saved.")}>Save</Button></>}>
        <div className="space-y-4">{msg && <Alert tone="danger">{msg}</Alert>}<Input label="Section name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /><Input label="Student capacity (optional)" type="number" min="1" value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} help="Leave empty to use the college default (Settings), or unlimited if none is set." /></div>
      </Modal>
      <Modal open={dlg?.kind === "coord"} onClose={() => setDlg(null)} title={`Coordinators for section ${dlg?.s?.name}`} footer={<><Button variant="soft" onClick={() => setDlg(null)}>Cancel</Button><Button loading={busy} onClick={() => run(() => api.put(`/sections/${dlg.s.id}/coordinators`, { coordinatorIds: sel }), "Coordinators updated.")}>Save</Button></>}>
        {msg && <Alert tone="danger" className="mb-3">{msg}</Alert>}
        <Async state={coords} rows={2} isEmpty={(d) => !d.users.length} empty={<p className="text-[14px] text-ink-mute">No coordinator accounts exist yet. Add one under People.</p>}>
          {({ users, total }) => <><ul className="space-y-1">{users.map((u) => <li key={u.id}><label className="flex cursor-pointer items-center gap-3 rounded-well px-3 py-2 hover:bg-white/60"><input type="checkbox" className="accent-[#3F5F7A]" checked={sel.includes(u.id)} onChange={() => setSel(sel.includes(u.id) ? sel.filter((x) => x !== u.id) : [...sel, u.id])} /><span className="text-[14.5px]"><strong>{u.name}</strong> <span className="text-ink-mute">{u.email}</span></span></label></li>)}</ul>{total > users.length && <p className="mt-2 text-[12.5px] text-amber-ink">Showing the first {users.length} of {total} coordinators.</p>}</>}
        </Async>
      </Modal>
    </div>
  );
}
