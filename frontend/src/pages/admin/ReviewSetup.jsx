import { Copy, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, Async, Button, Card, ConfirmDialog, Modal, PageHeader, Tag } from "../../components/ui/index.jsx";
import { Input, Select, Toggle } from "../../components/ui/fields.jsx";
import { api, describeError } from "../../lib/api.js";
import { fmtDateTime } from "../../lib/format.js";
import { useLoad } from "../../lib/hooks.js";
import { useAuth } from "../../store/auth.js";
import { toast } from "../../store/toast.js";

const FILE_TYPES = ["pdf", "docx", "pptx", "xlsx", "zip", "png", "jpg"];
const TYPE_LABEL = { title: "Title & requirements", progress: "Progress with milestones", improvements: "Improvements & testing", report: "Final report" };
const toLocal = (v) => (v ? new Date(new Date(v).getTime() - new Date(v).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");

function EditDialog({ cfg, onClose, onSaved }) {
  const [f, setF] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (cfg) { setF(JSON.parse(JSON.stringify({ name: cfg.name, order: cfg.order, deadline: toLocal(cfg.deadline), fields: cfg.fields, milestones: cfg.milestones, individualContributions: cfg.individualContributions, upload: cfg.upload }))); setMsg(""); } }, [cfg]);
  if (!cfg || !f) return null;
  const save = async () => {
    setBusy(true); setMsg("");
    const body = { name: f.name, order: Number(f.order), deadline: f.deadline ? new Date(f.deadline).toISOString() : null, fields: f.fields, upload: f.upload, ...(cfg.type === "progress" ? { milestones: f.milestones, individualContributions: f.individualContributions } : {}) };
    try { await api.patch(`/reviews/config/${cfg.id}`, body); toast.success("Review updated."); onSaved(); onClose(); } catch (e) { const d = describeError(e); setMsg(typeof d.fields?.fields === "string" ? `${d.message}: ${d.fields.fields}` : d.message); } finally { setBusy(false); }
  };
  const setField = (i, patch) => setF({ ...f, fields: f.fields.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const setMs = (i, patch) => setF({ ...f, milestones: f.milestones.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  return (
    <Modal open onClose={onClose} wide title={`Edit: ${cfg.name}`} footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save changes</Button></>}>
      <div className="space-y-6">
        {msg && <Alert tone="danger">{msg}</Alert>}
        <Alert tone="info">Reviews that already have submissions are protected: fields and milestones can be marked <em>retired</em> but not removed, and the review type cannot change.</Alert>
        <div className="grid gap-4 sm:grid-cols-3"><Input className="sm:col-span-2" label="Review name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /><Input label="Order" type="number" min="1" value={f.order} onChange={(e) => setF({ ...f, order: e.target.value })} /></div>
        <Input label="Deadline (optional)" type="datetime-local" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} className="max-w-xs" help="Late submissions are flagged, not blocked." />

        <fieldset className="space-y-3"><legend className="label">Form fields</legend>
          {f.fields.map((fl, i) => (
            <div key={fl.key} className="well grid gap-3 p-3 sm:grid-cols-[1.4fr_1fr_auto_auto]">
              <Input aria-label="Label" value={fl.label} onChange={(e) => setField(i, { label: e.target.value })} disabled={fl.key === "projectTitle"} help={`Key: ${fl.key}${fl.kind === "select" ? " · choice list" : ""}`} />
              <Select aria-label="Type" value={fl.kind} disabled onChange={() => {}} options={[{ value: "text", label: "Short text" }, { value: "longtext", label: "Long text" }, { value: "select", label: "Choice" }]} />
              <label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" className="accent-[#3F5F7A]" checked={fl.required} onChange={(e) => setField(i, { required: e.target.checked })} />Required</label>
              <label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" className="accent-[#3F5F7A]" checked={Boolean(fl.deprecated)} disabled={fl.key === "projectTitle"} onChange={(e) => setField(i, { deprecated: e.target.checked })} />Retired</label>
            </div>
          ))}
          <Button variant="soft" size="sm" onClick={() => { const key = `field${f.fields.length + 1}`; setF({ ...f, fields: [...f.fields, { key, label: "New field", kind: "longtext", required: false, maxLength: 3000, options: [], deprecated: false }] }); }}><Plus size={14} />Add text field</Button>
        </fieldset>

        {cfg.type === "progress" && (
          <>
            <Toggle checked={f.individualContributions} onChange={(v) => setF({ ...f, individualContributions: v })} label="Collect individual contributions" hint="Each team member records their own work separately from the team's progress." />
            <fieldset className="space-y-3"><legend className="label">Milestones</legend>
              {f.milestones.map((m, i) => (
                <div key={m.key} className="well grid items-center gap-3 p-3 sm:grid-cols-[1fr_auto_auto]">
                  <Input aria-label="Milestone label" value={m.label} onChange={(e) => setMs(i, { label: e.target.value })} help={`Key: ${m.key}`} />
                  <label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" className="accent-[#3F5F7A]" checked={Boolean(m.deprecated)} onChange={(e) => setMs(i, { deprecated: e.target.checked })} />Retired</label>
                  {!cfg.hasHistory && <Button variant="ghost" size="sm" aria-label="Remove milestone" onClick={() => setF({ ...f, milestones: f.milestones.filter((_, j) => j !== i) })}><Trash2 size={15} /></Button>}
                </div>
              ))}
              <Button variant="soft" size="sm" onClick={() => { const n = f.milestones.length + 1; setF({ ...f, milestones: [...f.milestones, { key: `milestone${n}`, label: `Milestone ${n}`, deprecated: false }] }); }}><Plus size={14} />Add milestone</Button>
            </fieldset>
          </>
        )}

        <fieldset className="space-y-3"><legend className="label">File upload</legend>
          <Toggle checked={f.upload.enabled} onChange={(v) => setF({ ...f, upload: { ...f.upload, enabled: v, required: v ? f.upload.required : false } })} label="Accept a file with submissions" hint="Ordinary progress updates do not need a file." />
          {f.upload.enabled && (
            <div className="space-y-3 pl-1">
              <Toggle checked={f.upload.required} onChange={(v) => setF({ ...f, upload: { ...f.upload, required: v } })} label="File is required" />
              <div className="flex flex-wrap gap-2">{FILE_TYPES.map((t) => <label key={t} className={`cursor-pointer rounded-well px-3 py-1.5 text-[13px] font-semibold uppercase ${f.upload.acceptedTypes.includes(t) ? "clay-sm text-slate-deep" : "well text-ink-soft"}`}><input type="checkbox" className="sr-only" checked={f.upload.acceptedTypes.includes(t)} onChange={() => setF({ ...f, upload: { ...f.upload, acceptedTypes: f.upload.acceptedTypes.includes(t) ? f.upload.acceptedTypes.filter((x) => x !== t) : [...f.upload.acceptedTypes, t] } })} />{f.upload.acceptedTypes.includes(t) && "✓ "}{t}</label>)}</div>
              <Input className="max-w-xs" label="Maximum size (MB)" type="number" min="1" max="25" value={f.upload.maxSizeMB} onChange={(e) => setF({ ...f, upload: { ...f.upload, maxSizeMB: Number(e.target.value) } })} />
            </div>
          )}
        </fieldset>
      </div>
    </Modal>
  );
}

function NewDialog({ open, onClose, sections, user, onSaved }) {
  const [f, setF] = useState({ key: "", name: "", order: 5, type: "improvements", section: user.role === "coordinator" ? sections[0]?.id || "" : "" });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState({});
  const save = async () => { setMsg(""); setErr({}); try { await api.post("/reviews/config", { ...f, order: Number(f.order), section: f.section || undefined }); toast.success("Review added."); onSaved(); onClose(); } catch (e) { const d = describeError(e); setMsg(d.message); setErr(d.fields); } };
  return (
    <Modal open={open} onClose={onClose} title="Add a review" footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button onClick={save}>Add review</Button></>}>
      <div className="space-y-4">{msg && <Alert tone="danger">{msg}</Alert>}
        <Input label="Name" required value={f.name} error={err.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <div className="grid gap-4 sm:grid-cols-2"><Input label="Key" required value={f.key} error={err.key} onChange={(e) => setF({ ...f, key: e.target.value.toLowerCase() })} help="e.g. review-5. Cannot change later." /><Input label="Order" type="number" min="1" value={f.order} error={err.order} onChange={(e) => setF({ ...f, order: e.target.value })} /></div>
        <Select label="Kind of review" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))} help="Fields can be edited after creation." />
        {sections.length > 0 && <Select label={user.role === "coordinator" ? "Section" : "Applies to"} value={f.section} onChange={(e) => setF({ ...f, section: e.target.value })} placeholder={user.role === "coordinator" ? undefined : "Whole college"} options={sections.map((s) => ({ value: s.id, label: `Section ${s.name}` }))} />}
      </div>
    </Modal>
  );
}

export default function ReviewSetup() {
  const user = useAuth((s) => s.user);
  const state = useLoad(() => api.get("/reviews/config", { params: { raw: true } }).then((r) => r.data.reviews), []);
  const sections = useLoad(() => api.get("/sections").then((r) => r.data.sections), []);
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const [adding, setAdding] = useState(false);
  const secName = (id) => sections.data?.find((s) => s.id === id)?.name;
  const canEdit = (c) => user.role === "hod" || c.section;

  const [ovr, setOvr] = useState(null);
  const [ovrSection, setOvrSection] = useState("");
  const makeCopy = async (c, sectionId) => {
    try { await api.post(`/reviews/config/${c.id}/override`, { section: sectionId }); toast.success("Section copy created. Edit it to customise."); setOvr(null); state.reload(); } catch (e) { toast.error(describeError(e).message); }
  };
  const override = (c) => (user.role === "coordinator" && sections.data?.length === 1 ? makeCopy(c, sections.data[0].id) : (setOvrSection(sections.data?.[0]?.id || ""), setOvr(c)));
  const remove = async () => { try { const { data } = await api.delete(`/reviews/config/${del.id}`); toast.success(data.message); setDel(null); state.reload(); } catch (e) { toast.error(describeError(e).message); } };

  return (
    <div className="rise">
      <PageHeader title="Review setup" subtitle={user.role === "hod" ? "Configure the review sequence for the whole college." : "Customise reviews for your sections. College-wide defaults are set by the HOD."} actions={<Button onClick={() => setAdding(true)}><Plus size={16} />Add review</Button>} />
      <Async state={state} rows={4}>
        {(list) => (
          <div className="space-y-4">
            {list.map((c) => (
              <Card key={c.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2"><h2 className="text-[17px] font-bold">{c.name}</h2><Tag tone={c.section ? "info" : "neutral"}>{c.section ? `Section ${secName(c.section) || ""} only` : "College-wide"}</Tag></div>
                    <p className="mt-1 text-[13.5px] text-ink-mute">Order {c.order} · {TYPE_LABEL[c.type]} · key <code>{c.key}</code></p>
                    <p className="mt-2 text-[13.5px] text-ink-soft">Deadline: {c.deadline ? fmtDateTime(c.deadline) : "none"} · {c.fields.filter((x) => !x.deprecated).length} fields{c.type === "progress" ? ` · ${c.milestones.filter((m) => !m.deprecated).length} milestones` : ""} · File: {c.upload.enabled ? `${c.upload.required ? "required" : "optional"}, ${c.upload.acceptedTypes.join("/").toUpperCase()}, ≤${c.upload.maxSizeMB} MB` : "not used"}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canEdit(c) ? <><Button variant="soft" size="sm" onClick={() => setEdit(c)}>Edit</Button><Button variant="ghost" size="sm" aria-label={`Remove ${c.name}`} onClick={() => setDel(c)}><Trash2 size={15} /></Button></> : <Button variant="soft" size="sm" onClick={() => override(c)}><Copy size={14} />Customise for my section</Button>}
                    {user.role === "hod" && !c.section && <Button variant="ghost" size="sm" onClick={() => override(c)}><Copy size={14} />Section copy</Button>}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Async>
      <EditDialog cfg={edit} onClose={() => setEdit(null)} onSaved={state.reload} />
      <NewDialog open={adding} onClose={() => setAdding(false)} sections={sections.data || []} user={user} onSaved={state.reload} />
      <Modal open={Boolean(ovr)} onClose={() => setOvr(null)} title="Customise for a section" footer={<><Button variant="soft" onClick={() => setOvr(null)}>Cancel</Button><Button disabled={!ovrSection} onClick={() => makeCopy(ovr, ovrSection)}>Create section copy</Button></>}>
        <p className="mb-4 text-[14px] text-ink-soft">Creates a copy of “{ovr?.name}” that applies only to the chosen section. The college-wide review is not changed, and existing submissions stay with the review they were made under.</p>
        <Select label="Section" value={ovrSection} onChange={(e) => setOvrSection(e.target.value)} options={(sections.data || []).map((s) => ({ value: s.id, label: `Section ${s.name}` }))} />
      </Modal>
      <ConfirmDialog open={Boolean(del)} onClose={() => setDel(null)} danger title="Remove this review?" confirmLabel="Remove" message="If the review already has submissions it is archived instead of deleted, so history is preserved." onConfirm={remove} />
    </div>
  );
}
