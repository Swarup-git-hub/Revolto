import { History } from "lucide-react";
import { useState } from "react";
import { Async, Button, Card, EmptyState, PageHeader, Tag } from "../../components/ui/index.jsx";
import { Select } from "../../components/ui/fields.jsx";
import { api } from "../../lib/api.js";
import { fmtDateTime } from "../../lib/format.js";
import { useLoad } from "../../lib/hooks.js";

const short = (v) => (v === undefined || v === null ? "" : typeof v === "string" ? v : JSON.stringify(v));

export default function Audit() {
  const [entity, setEntity] = useState("");
  const [page, setPage] = useState(1);
  const state = useLoad(() => api.get("/audit", { params: { entity: entity || undefined, page } }).then((r) => r.data), [entity, page]);
  return (
    <div className="rise">
      <PageHeader title="Audit log" subtitle="Administrative changes, overrides and exports, newest first." />
      <Card>
        <Select aria-label="Entity" value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }} placeholder="All records" className="mb-4 w-56" options={["BookingRequest", "BookingPolicy", "BookingSlot", "Team", "User", "Section", "ReviewConfig", "Settings", "ImportJob", "Report"].map((v) => ({ value: v, label: v }))} />
        <Async state={state} rows={5} isEmpty={(d) => !d.logs.length} empty={<EmptyState icon={History} title="No entries" hint="Nothing has been recorded for this filter." />}>
          {(d) => (
            <>
              <ul className="space-y-2">{d.logs.map((l) => (
                <li key={l.id}><details className="well px-4 py-3">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-3 text-[14px]"><Tag tone={l.action === "OVERRIDE" ? "warning" : "neutral"}>{l.action}</Tag><strong>{l.entity}</strong><span className="text-ink-soft">{l.entityName}</span><span className="ml-auto text-[12.5px] text-ink-mute">{l.actor} ({l.role}) · {fmtDateTime(l.at)}</span></summary>
                  <div className="mt-3 space-y-2 text-[13px]">
                    {l.reason && <p><strong>Reason:</strong> {l.reason}</p>}
                    {l.before !== undefined && <p className="break-words"><strong>Before:</strong> <code className="text-ink-soft">{short(l.before)}</code></p>}
                    {l.after !== undefined && <p className="break-words"><strong>After:</strong> <code className="text-ink-soft">{short(l.after)}</code></p>}
                  </div>
                </details></li>
              ))}</ul>
              <div className="mt-4 flex items-center justify-between text-[13.5px] text-ink-soft"><span>{d.total} entries</span><span className="flex gap-2"><Button variant="soft" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button variant="soft" size="sm" disabled={page * d.limit >= d.total} onClick={() => setPage(page + 1)}>Next</Button></span></div>
            </>
          )}
        </Async>
      </Card>
    </div>
  );
}
