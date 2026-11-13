import { Plus, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Async, Button, Card, EmptyState, Modal, PageHeader, Pager, StatusBadge } from "../components/ui/index.jsx";
import { Input, SearchBox, Select } from "../components/ui/fields.jsx";
import { api, describeError } from "../lib/api.js";
import { fmtDateTime } from "../lib/format.js";
import { useDebounced, useLoad } from "../lib/hooks.js";
import { toast } from "../store/toast.js";
import { useAuth } from "../store/auth.js";

function NewTeamDialog({ open, onClose, sections, onCreated }) {
  const [f, setF] = useState({ section: "", guide: "", teamId: "", projectTitle: "", memberIds: [] });
  const [err, setErr] = useState({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const guides = useLoad(() => api.get("/users/guides").then((r) => r.data.guides), []);
  const students = useLoad(() => (f.section ? api.get(`/users/available-students?section=${f.section}`).then((r) => r.data.users) : Promise.resolve([])), [f.section]);
  const save = async () => {
    setBusy(true); setErr({}); setMsg("");
    try { const { data } = await api.post("/teams", { ...f, teamId: f.teamId || undefined, projectTitle: f.projectTitle || undefined, leader: f.memberIds[0] }); toast.success(`Team ${data.team.teamId} created.`); onCreated(data.team); onClose(); }
    catch (e) { const d = describeError(e); setMsg(d.message); setErr(d.fields); } finally { setBusy(false); }
  };
  const toggle = (id) => setF((p) => ({ ...p, memberIds: p.memberIds.includes(id) ? p.memberIds.filter((x) => x !== id) : [...p.memberIds, id] }));
  return (
    <Modal open={open} onClose={onClose} title="New team" wide footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Create team</Button></>}>
      <div className="space-y-4">
        {msg && <Alert tone="danger">{msg}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Section" required value={f.section} onChange={(e) => setF({ ...f, section: e.target.value, memberIds: [] })} error={err.section} placeholder="Choose section" options={sections.map((s) => ({ value: s.id, label: s.name }))} />
          <Select label="Guide" required value={f.guide} onChange={(e) => setF({ ...f, guide: e.target.value })} error={err.guide} placeholder="Choose guide" options={(guides.data || []).map((g) => ({ value: g.id, label: `${g.name} (${g.teamCount} teams)` }))} />
          <Input label="Team ID (optional)" value={f.teamId} onChange={(e) => setF({ ...f, teamId: e.target.value })} error={err.teamId} help="Leave empty to generate one, e.g. A-T03." />
          <Input label="Project title (optional)" value={f.projectTitle} onChange={(e) => setF({ ...f, projectTitle: e.target.value })} />
        </div>
        <div>
          <span className="label">Members {f.memberIds.length ? `(${f.memberIds.length} selected — first selected becomes leader)` : ""}</span>
          {!f.section ? <p className="text-[13.5px] text-ink-mute">Choose a section to see students without a team.</p> : (
            <div className="well max-h-52 overflow-y-auto p-2">
              <Async state={students} rows={2} isEmpty={(d) => !d.length} empty={<p className="p-3 text-[13.5px] text-ink-mute">Every student in this section already has a team.</p>}>
                {(list) => list.map((s) => (
                  <label key={s.id} className="flex cursor-pointer items-center gap-3 rounded-well px-3 py-2 hover:bg-white/60">
                    <input type="checkbox" className="accent-[#3F5F7A]" checked={f.memberIds.includes(s.id)} onChange={() => toggle(s.id)} />
                    <span className="text-[14px]"><strong>{s.rollNumber}</strong> · {s.name}</span>
                  </label>
                ))}
              </Async>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default function Teams() {
  const user = useAuth((s) => s.user);
  const nav = useNavigate();
  const [search, setSearch] = useState("");
  const [section, setSection] = useState("");
  const [status, setStatus] = useState("active");
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const PAGE = 25;
  const q = useDebounced(search);
  const sections = useLoad(() => api.get("/sections").then((r) => r.data.sections), []);
  const state = useLoad(() => api.get("/teams", { params: { search: q || undefined, section: section || undefined, status, page, limit: PAGE } }).then((r) => r.data), [q, section, status, page]);
  useEffect(() => { if (state.data && !state.data.teams.length && page > 1) setPage(Math.max(1, Math.ceil(state.data.total / PAGE))); }, [state.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const canCreate = user.role === "hod" || user.role === "coordinator";
  return (
    <div className="rise">
      <PageHeader title={user.role === "guide" ? "My teams" : "Teams"} subtitle="Search and open a team to see its reviews, progress and feedback."
        actions={canCreate && <Button onClick={() => setOpen(true)}><Plus size={16} />New team</Button>} />
      <Card>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search team ID or title" />
          {(sections.data?.length || 0) > 1 && <Select aria-label="Section" value={section} onChange={(e) => { setSection(e.target.value); setPage(1); }} placeholder="All sections" options={(sections.data || []).map((s) => ({ value: s.id, label: `Section ${s.name}` }))} className="w-44" />}
          <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={[{ value: "active", label: "Active teams" }, { value: "archived", label: "Archived" }]} className="w-44" />
        </div>
        <Async state={state} rows={5} isEmpty={(d) => !d.teams.length} empty={<EmptyState icon={Users} title="No teams found" hint={q || section ? "Try clearing the search or filters." : canCreate ? "Create the first team or import teams from a spreadsheet." : "Teams assigned to you will appear here."} />}>
          {({ teams, total }) => (
            <div className="overflow-x-auto">
              <table className="w-full text-[14px]">
                <thead><tr><th className="th">Team</th><th className="th">Project title</th><th className="th">Section / Guide</th><th className="th">Current review</th><th className="th">Milestones</th><th className="th">Final report</th><th className="th">Last update</th></tr></thead>
                <tbody>
                  {teams.map((t) => (
                    <tr key={t.id} className="row-link border-t border-white/70" tabIndex={0} onClick={() => nav(`/teams/${t.id}`)} onKeyDown={(e) => e.key === "Enter" && nav(`/teams/${t.id}`)}>
                      <td className="td font-bold text-slate-deep">{t.teamId}<div className="text-[12px] font-normal text-ink-mute">{t.memberCount} member(s)</div></td>
                      <td className="td max-w-[260px]"><div className="truncate">{t.projectTitle || <span className="text-ink-mute">Not submitted</span>}</div>{t.projectTitle && <StatusBadge status={t.titleStatus} label={`Title ${t.titleStatus.replace("_", " ")}`} className="mt-1" />}</td>
                      <td className="td">{t.section.name}<div className="text-[12.5px] text-ink-mute">{t.guide.name}</div></td>
                      <td className="td">{t.progress?.currentReview ? <><div className="text-[13px] font-semibold">{t.progress.currentReview.name.split("—")[0]}</div><StatusBadge status={t.progress.currentReview.status} /></> : <StatusBadge status="approved" label="All approved" />}</td>
                      <td className="td">{t.progress?.milestones.recorded ? `${t.progress.milestones.completed} of ${t.progress.milestones.total} done` : <span className="text-ink-mute">Not recorded</span>}</td>
                      <td className="td">{t.progress?.reportStatus ? <StatusBadge status={t.progress.reportStatus} /> : "—"}</td>
                      <td className="td text-[13px] text-ink-soft">{fmtDateTime(t.progress?.lastUpdate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pager page={page} limit={PAGE} total={total} onPage={setPage} label="teams" />
            </div>
          )}
        </Async>
      </Card>
      {canCreate && <NewTeamDialog open={open} onClose={() => setOpen(false)} sections={sections.data || []} onCreated={(t) => nav(`/teams/${t.id}`)} />}
    </div>
  );
}
