import { Plus, Trash2 } from "lucide-react";
import { Button } from "../ui/index.jsx";
import { Input, Select, Textarea } from "../ui/fields.jsx";

/** Renders a review's configured fields; values/errors are plain objects keyed by field key. */
export function DynamicForm({ fields, values, onChange, errors = {} }) {
  return (
    <div className="space-y-4">
      {fields.filter((f) => !f.deprecated).map((f) => {
        const common = { label: f.label, required: f.required, error: errors[f.key], value: values[f.key] ?? "", onChange: (e) => onChange({ ...values, [f.key]: e.target.value }) };
        if (f.kind === "select") return <Select key={f.key} {...common} placeholder="Choose…" options={f.options} />;
        if (f.kind === "longtext") return <Textarea key={f.key} {...common} maxLength={f.maxLength} />;
        return <Input key={f.key} {...common} maxLength={f.maxLength} />;
      })}
    </div>
  );
}

const STATUS_OPTIONS = [{ value: "not_started", label: "Not started" }, { value: "in_progress", label: "In progress" }, { value: "completed", label: "Completed" }];

/** Team milestone checklist: every configured milestone is reported explicitly. */
export function MilestoneEditor({ milestones, value, onChange, errors = {} }) {
  const active = milestones.filter((m) => !m.deprecated);
  const get = (k) => value.find((x) => x.key === k) || { key: k, status: "not_started" };
  const set = (k, patch) => {
    const next = { ...get(k), ...patch };
    if (patch.status === "completed") next.percent = 100;
    if (patch.status === "not_started") next.percent = 0;
    if (patch.status === "in_progress" && (next.percent === 0 || next.percent === 100)) delete next.percent;
    onChange(active.map((m) => (m.key === k ? next : get(m.key))));
  };
  return (
    <fieldset className="space-y-3">
      <legend className="label">Milestone checklist <span className="text-brick" aria-hidden>*</span></legend>
      {active.map((m) => {
        const cur = get(m.key);
        return (
          <div key={m.key} className="well grid gap-3 p-3.5 sm:grid-cols-[1.2fr_1fr_110px]">
            <div className="self-center text-[14.5px] font-semibold">{m.label}</div>
            <Select aria-label={`${m.label} status`} value={cur.status} onChange={(e) => set(m.key, { status: e.target.value })} options={STATUS_OPTIONS} />
            <Input aria-label={`${m.label} percentage`} type="number" min="0" max="100" placeholder="% (opt.)" value={cur.percent ?? ""} onChange={(e) => set(m.key, { percent: e.target.value === "" ? undefined : Number(e.target.value) })} />
            {errors[m.key] && <p className="err sm:col-span-3">{errors[m.key]}</p>}
          </div>
        );
      })}
    </fieldset>
  );
}

/** Individual contribution tasks (each tied to a milestone). */
export function TaskEditor({ milestones, tasks, onChange, errors = {} }) {
  const active = milestones.filter((m) => !m.deprecated);
  const upd = (i, patch) => onChange(tasks.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  return (
    <div className="space-y-3">
      <span className="label">Tasks you worked on (optional)</span>
      {tasks.map((t, i) => (
        <div key={i} className="well grid gap-3 p-3.5 sm:grid-cols-[1fr_1.4fr_1fr_auto]">
          <Select aria-label="Milestone" value={t.milestoneKey} onChange={(e) => upd(i, { milestoneKey: e.target.value })} placeholder="Milestone" options={active.map((m) => ({ value: m.key, label: m.label }))} />
          <Input aria-label="Task description" placeholder="What did you do?" value={t.description} onChange={(e) => upd(i, { description: e.target.value })} />
          <Select aria-label="Task status" value={t.status} onChange={(e) => upd(i, { status: e.target.value })} options={STATUS_OPTIONS} />
          <Button variant="ghost" size="sm" aria-label="Remove task" onClick={() => onChange(tasks.filter((_, j) => j !== i))}><Trash2 size={16} /></Button>
          {errors[`tasks.${i}`] && <p className="err sm:col-span-4">{errors[`tasks.${i}`]}</p>}
        </div>
      ))}
      {tasks.length < 20 && <Button variant="soft" size="sm" onClick={() => onChange([...tasks, { milestoneKey: "", description: "", status: "in_progress" }])}><Plus size={15} />Add task</Button>}
    </div>
  );
}

/** Read-only view of a stored submission. */
export function SubmissionData({ review, data }) {
  const fields = review.fields.filter((f) => data?.[f.key] !== undefined);
  const labelOf = (f, v) => (f.kind === "select" ? f.options.find((o) => o.value === v)?.label || v : v);
  return (
    <div className="space-y-3">
      {fields.map((f) => (
        <div key={f.key}>
          <div className="text-[12.5px] font-semibold text-ink-mute">{f.label}</div>
          <div className="whitespace-pre-wrap text-[14.5px]">{labelOf(f, data[f.key])}</div>
        </div>
      ))}
      {data?.milestones && (
        <div>
          <div className="mb-1.5 text-[12.5px] font-semibold text-ink-mute">Milestones</div>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {data.milestones.map((m) => (
              <li key={m.key} className="well flex items-center justify-between gap-2 px-3 py-2 text-[14px]">
                <span className="font-semibold">{review.milestones.find((x) => x.key === m.key)?.label || m.key}</span>
                <span className="text-ink-soft">{STATUS_OPTIONS.find((s) => s.value === m.status)?.label}{m.percent !== undefined ? ` · ${m.percent}%` : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
