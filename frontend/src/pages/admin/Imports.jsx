import { Download, FileUp } from "lucide-react";
import { useState } from "react";
import { Alert, Button, Card, PageHeader, StatusBadge, Tag } from "../../components/ui/index.jsx";
import { Field, Select } from "../../components/ui/fields.jsx";
import { api, describeError, download } from "../../lib/api.js";
import { useAuth } from "../../store/auth.js";
import { toast } from "../../store/toast.js";

const TYPES = { students: ["Students", "Roll number, name, email, section"], teams: ["Teams", "Section, guide email, leader and member roll numbers"], staff: ["Guides & coordinators", "HOD only. Name, email, role, sections"] };

export default function Imports() {
  const user = useAuth((s) => s.user);
  const types = Object.keys(TYPES).filter((t) => t !== "staff" || user.role === "hod");
  const [type, setType] = useState("students");
  const [file, setFile] = useState(null);
  const [job, setJob] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const reset = () => { setJob(null); setResult(null); setFile(null); setErr(""); };

  const preview = async () => {
    setBusy("preview"); setErr(""); setResult(null);
    try { const fd = new FormData(); fd.append("file", file); const { data } = await api.post(`/imports/${type}/preview`, fd); setJob(data); }
    catch (e) { setErr(describeError(e).message); } finally { setBusy(""); }
  };
  const confirm = async () => {
    setBusy("confirm");
    try { const { data } = await api.post(`/imports/jobs/${job.id}/confirm`, { confirm: true }); setResult(data.result); setJob(null); toast.success("Import finished."); }
    catch (e) { setErr(describeError(e).message); } finally { setBusy(""); }
  };
  const dl = (fn) => fn().catch((e) => toast.error(describeError(e).message));

  return (
    <div className="rise">
      <PageHeader title="Bulk import" subtitle="Download the template, upload your file, review the preview, then confirm. Existing records are never overwritten." />
      <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <Card>
          <h2 className="mb-4 text-[16px] font-bold">1. Choose and upload</h2>
          <Select label="What are you importing?" value={type} onChange={(e) => { setType(e.target.value); reset(); }} options={types.map((t) => ({ value: t, label: TYPES[t][0] }))} help={TYPES[type][1]} />
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="soft" size="sm" onClick={() => dl(() => download(`/imports/templates/${type}?format=xlsx`, `${type}-template.xlsx`))}><Download size={14} />Excel template</Button>
            <Button variant="soft" size="sm" onClick={() => dl(() => download(`/imports/templates/${type}?format=csv`, `${type}-template.csv`))}><Download size={14} />CSV template</Button>
          </div>
          <Field label="File (.xlsx or .csv, up to 2 MB, 2000 rows)" className="mt-5"><input type="file" className="field" accept=".xlsx,.csv" onChange={(e) => { setFile(e.target.files?.[0] || null); setJob(null); setResult(null); }} /></Field>
          <Button className="mt-4 w-full" loading={busy === "preview"} disabled={!file} onClick={preview}><FileUp size={16} />Preview import</Button>
          {err && <Alert tone="danger" className="mt-4">{err}</Alert>}
        </Card>

        <Card>
          <h2 className="mb-4 text-[16px] font-bold">2. Review and confirm</h2>
          {!job && !result && <p className="text-[14px] text-ink-mute">The preview appears here. Nothing is saved until you confirm.</p>}
          {result && (
            <div className="space-y-3">
              <Alert tone="success"><strong>{result.created}</strong> record(s) created · <strong>{result.skipped}</strong> row(s) skipped (errors/duplicates) · <strong>{result.failed}</strong> failed</Alert>
              {result.failures?.length > 0 && <ul className="well list-disc space-y-1 p-4 pl-8 text-[13.5px]">{result.failures.map((f, i) => <li key={i}>{f}</li>)}</ul>}
              <Button variant="soft" onClick={reset}>Start another import</Button>
            </div>
          )}
          {job && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2"><Tag>{job.summary.total} rows</Tag><Tag tone="success">{job.summary.valid} ready</Tag><Tag tone="danger">{job.summary.errors} with errors</Tag><Tag tone="warning">{job.summary.duplicates} duplicates / conflicts</Tag></div>
              <div className="well max-h-[420px] overflow-auto">
                <table className="w-full text-[13.5px]"><thead className="sticky top-0 bg-[#E4E9E7]"><tr><th className="th">Row</th><th className="th">Status</th><th className="th">Data</th><th className="th">Problems</th></tr></thead><tbody>
                  {job.rows.map((r) => (
                    <tr key={r.rowNumber} className="border-t border-white/70 align-top">
                      <td className="td">{r.rowNumber}</td>
                      <td className="td"><StatusBadge status={r.status === "valid" ? "approved" : r.status === "error" ? "rejected" : "changes_required"} label={r.status === "valid" ? "Ready" : r.status === "error" ? "Error" : "Skipped"} /></td>
                      <td className="td text-ink-soft">{Object.values(r.raw).filter(Boolean).join(" · ")}</td>
                      <td className="td text-brick-ink">{r.errors.join("; ")}</td>
                    </tr>
                  ))}
                </tbody></table>
              </div>
              {job.truncated && <p className="text-[12.5px] text-ink-mute">Showing the first 300 rows. The error report contains every problem row.</p>}
              <div className="flex flex-wrap items-center gap-3">
                {job.summary.errors + job.summary.duplicates > 0 && <Button variant="soft" onClick={() => dl(() => download(`/imports/jobs/${job.id}/errors.csv`, `${type}-import-errors.csv`))}><Download size={15} />Error report (CSV)</Button>}
                <Button loading={busy === "confirm"} disabled={job.summary.valid === 0} onClick={confirm}>Confirm — create {job.summary.valid} record(s)</Button>
                <Button variant="ghost" onClick={reset}>Discard</Button>
              </div>
              <p className="text-[12.5px] text-ink-mute">Only “Ready” rows are created. Rows that match existing records are skipped and the existing records stay unchanged.</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
