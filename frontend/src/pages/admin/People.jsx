import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, Async, Button, Card, ConfirmDialog, EmptyState, Modal, PageHeader, Pager, StatusBadge, Tag } from "../../components/ui/index.jsx";
import { Input, SearchBox, Select } from "../../components/ui/fields.jsx";
import { api, describeError } from "../../lib/api.js";
import { ROLE_LABEL } from "../../lib/format.js";
import { useDebounced, useLoad } from "../../lib/hooks.js";
import { useAuth } from "../../store/auth.js";
import { toast } from "../../store/toast.js";

function UserDialog({ open, onClose, editing, sections, me, onSaved }) {
  const empty = { name: "", email: "", role: "student", rollNumber: "", phone: "", section: "", sections: [] };
  const [f, setF] = useState(empty);
  const [err, setErr] = useState({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setErr({}); setMsg("");
    setF(editing ? { name: editing.name, email: editing.email, role: editing.role, rollNumber: editing.rollNumber || "", phone: editing.phone || "", section: editing.section?.id || "", sections: editing.sections.map((s) => s.id) } : { ...empty, section: me.role === "coordinator" ? me.sections[0]?.id || "" : "" });
  }, [open, editing?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const isHod = me.role === "hod";
  const save = async () => {
    setBusy(true); setErr({}); setMsg("");
    const body = { name: f.name, phone: f.phone || undefined, ...(f.role === "student" ? { rollNumber: f.rollNumber, section: f.section || undefined } : {}), ...(f.role === "coordinator" ? { sections: f.sections } : {}) };
    try {
      if (editing) await api.patch(`/users/${editing.id}`, { ...body, ...(isHod ? { email: f.email, role: f.role } : {}) });
      else await api.post("/users", { ...body, email: f.email, role: f.role });
      toast.success(editing ? "Changes saved." : "Account created."); onSaved(); onClose();
    } catch (e) { const d = describeError(e); setMsg(d.message); setErr(d.fields); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit person" : "Add person"} footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>{editing ? "Save changes" : "Create account"}</Button></>}>
      <div className="space-y-4">
        {msg && <Alert tone="danger">{msg}</Alert>}
        <Input label="Full name" required value={f.name} error={err.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Input label="Email" type="email" required disabled={Boolean(editing) && !isHod} value={f.email} error={err.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        {isHod ? <Select label="Role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} options={Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label }))} /> : null}
        {f.role === "student" && <>
          <Input label="Roll number" required value={f.rollNumber} error={err.rollNumber} onChange={(e) => setF({ ...f, rollNumber: e.target.value })} />
          <Select label="Section" required value={f.section} error={err.section} onChange={(e) => setF({ ...f, section: e.target.value })} placeholder="Choose section" options={sections.map((s) => ({ value: s.id, label: s.name }))} />
        </>}
        {f.role === "coordinator" && (
          <fieldset><legend className="label">Assigned sections</legend><div className="flex flex-wrap gap-2">{sections.map((s) => <label key={s.id} className={`cursor-pointer rounded-well px-3 py-1.5 text-[14px] font-semibold ${f.sections.includes(s.id) ? "clay-sm text-slate-deep" : "well text-ink-soft"}`}><input type="checkbox" className="sr-only" checked={f.sections.includes(s.id)} onChange={() => setF({ ...f, sections: f.sections.includes(s.id) ? f.sections.filter((x) => x !== s.id) : [...f.sections, s.id] })} />{f.sections.includes(s.id) && "✓ "}{s.name}</label>)}</div></fieldset>
        )}
        <Input label="Phone (optional)" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
      </div>
    </Modal>
  );
}

export default function People() {
  const me = useAuth((s) => s.user);
  const [role, setRole] = useState(me.role === "coordinator" ? "student" : "");
  const [section, setSection] = useState("");
  const [status, setStatus] = useState("active");
  const [search, setSearch] = useState("");
  const q = useDebounced(search);
  const [dlg, setDlg] = useState(null);
  const [page, setPage] = useState(1);
  const PAGE = 25;
  const sections = useLoad(() => api.get("/sections").then((r) => r.data.sections), []);
  const state = useLoad(() => api.get("/users", { params: { role: role || undefined, section: section || undefined, status, search: q || undefined, page, limit: PAGE } }).then((r) => r.data), [role, section, status, q, page]);
  // after an archive/restore the last page can become empty: step back instead of showing nothing
  useEffect(() => { if (state.data && !state.data.users.length && page > 1) setPage(Math.max(1, Math.ceil(state.data.total / PAGE))); }, [state.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (path, m) => { try { await api.post(path, {}); toast.success(m); setDlg(null); state.reload(); } catch (e) { toast.error(describeError(e).message); } };
  return (
    <div className="rise">
      <PageHeader title="People" subtitle={me.role === "hod" ? "Students, guides, coordinators and HODs." : "Students and guides in your sections."} actions={<Button onClick={() => setDlg({ kind: "edit" })}><Plus size={16} />Add person</Button>} />
      <Card>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search name, email or roll no." />
          <Select aria-label="Role" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} placeholder="All roles" className="w-40" options={Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label }))} />
          <Select aria-label="Section" value={section} onChange={(e) => { setSection(e.target.value); setPage(1); }} placeholder="All sections" className="w-40" options={(sections.data || []).map((s) => ({ value: s.id, label: s.name }))} />
          <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-40" options={[{ value: "active", label: "Active" }, { value: "archived", label: "Archived" }]} />
        </div>
        <Async state={state} rows={5} isEmpty={(d) => !d.users.length} empty={<EmptyState title="No people found" hint="Try different filters, or add someone." />}>
          {({ users, total }) => (
            <div className="overflow-x-auto"><table className="w-full text-[14px]"><thead><tr><th className="th">Name</th><th className="th">Role</th><th className="th">Roll no.</th><th className="th">Section</th><th className="th">Team</th><th className="th" /></tr></thead><tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-white/70">
                  <td className="td"><div className="font-semibold">{u.name}</div><div className="text-[12.5px] text-ink-mute">{u.email}</div></td>
                  <td className="td"><Tag>{ROLE_LABEL[u.role]}</Tag></td>
                  <td className="td">{u.rollNumber || "—"}</td>
                  <td className="td">{u.role === "coordinator" ? u.sections.map((s) => s.name).join(", ") || "—" : u.section?.name || "—"}</td>
                  <td className="td">{u.team?.teamId || "—"}</td>
                  <td className="td text-right">{u.isActive ? <><Button variant="ghost" size="sm" onClick={() => setDlg({ kind: "edit", u })}>Edit</Button><Button variant="ghost" size="sm" onClick={() => setDlg({ kind: "archive", u })}>Archive</Button></> : <><StatusBadge status="cancelled" label="Archived" /><Button variant="ghost" size="sm" onClick={() => act(`/users/${u.id}/restore`, "Account restored.")}>Restore</Button></>}</td>
                </tr>
              ))}
            </tbody></table><Pager page={page} limit={PAGE} total={total} onPage={setPage} label="accounts" /></div>
          )}
        </Async>
      </Card>
      <UserDialog open={dlg?.kind === "edit"} onClose={() => setDlg(null)} editing={dlg?.u} sections={me.role === "hod" ? sections.data || [] : (sections.data || [])} me={me} onSaved={state.reload} />
      <ConfirmDialog open={dlg?.kind === "archive"} onClose={() => setDlg(null)} danger title="Archive this account?" confirmLabel="Archive" message={`${dlg?.u?.name} will no longer be able to sign in. Their submissions, contributions and history are kept. You can restore the account later.`} onConfirm={() => act(`/users/${dlg.u.id}/archive`, "Account archived.")} />
    </div>
  );
}
