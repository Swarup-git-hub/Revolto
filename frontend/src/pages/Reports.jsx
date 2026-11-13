import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { useState } from "react";
import { Button, Card, PageHeader } from "../components/ui/index.jsx";
import { Input, Select } from "../components/ui/fields.jsx";
import { api, describeError, download } from "../lib/api.js";
import { useLoad } from "../lib/hooks.js";
import { useAuth } from "../store/auth.js";
import { toast } from "../store/toast.js";

export default function Reports() {
  const user = useAuth((s) => s.user);
  const [f, setF] = useState({ section: "", guide: "", team: "", review: "", progress: "", submissionStatus: "" });
  const [busy, setBusy] = useState("");
  const sections = useLoad(() => api.get("/sections").then((r) => r.data.sections), []);
  const guides = useLoad(() => (user.role === "guide" ? Promise.resolve([]) : api.get("/users/guides").then((r) => r.data.guides)), []);
  const reviews = useLoad(() => api.get("/reviews/config").then((r) => r.data.reviews), []);
  const qs = () => { const p = new URLSearchParams(); Object.entries(f).forEach(([k, v]) => v && p.set(k, v)); const s = p.toString(); return s ? `?${s}` : ""; };
  const get = async (kind, path, file) => { setBusy(kind); try { await download(`/exports/${path}${qs()}`, file); toast.success("Report downloaded."); } catch (e) { const d = e.response?.data instanceof Blob ? "The export could not be generated." : describeError(e).message; toast.error(d); } finally { setBusy(""); } };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="rise">
      <PageHeader title="Reports & exports" subtitle="Download recorded team-wise and student-wise progress. Exports only include data you are allowed to see, and show when they were generated and which filters were applied." />
      <Card>
        <h2 className="mb-4 text-[16px] font-bold">Filters (optional)</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(sections.data?.length || 0) > 1 && <Select label="Section" value={f.section} onChange={set("section")} placeholder="All sections in scope" options={(sections.data || []).map((s) => ({ value: s.id, label: s.name }))} />}
          {user.role !== "guide" && <Select label="Guide" value={f.guide} onChange={set("guide")} placeholder="All guides" options={(guides.data || []).map((g) => ({ value: g.id, label: g.name }))} />}
          <Input label="Team ID" value={f.team} onChange={set("team")} placeholder="e.g. A-T01" />
          <Select label="Review (for current-review status)" value={f.review} onChange={set("review")} placeholder="Team's current review" options={(reviews.data || []).map((r) => ({ value: r.key, label: r.name.split("—")[0].trim() }))} />
          <Select label="Milestone progress" value={f.progress} onChange={set("progress")} placeholder="Any" options={[{ value: "not_recorded", label: "Not recorded" }, { value: "in_progress", label: "In progress" }, { value: "completed", label: "All milestones completed" }]} />
          <Select label="Guide review status" value={f.submissionStatus} onChange={set("submissionStatus")} placeholder="Any" options={[{ value: "not_submitted", label: "Not submitted" }, { value: "submitted", label: "Submitted" }, { value: "under_review", label: "Under review" }, { value: "changes_required", label: "Changes required" }, { value: "approved", label: "Approved" }]} />
        </div>
      </Card>
      <div className="mt-6 grid gap-5 md:grid-cols-3">
        {[["xlsx", "Excel workbook", "Team-wise and Student-wise sheets", "progress.xlsx", "progress-report.xlsx", FileSpreadsheet], ["teams", "Team-wise CSV", "One row per team", "teams.csv", "team-progress.csv", FileText], ["students", "Student-wise CSV", "One row per student", "students.csv", "student-progress.csv", FileText]].map(([k, t, d, path, file, Icon]) => (
          <Card key={k}>
            <div className="well mb-3 grid h-11 w-11 place-items-center text-slate-brand"><Icon size={20} /></div>
            <h3 className="text-[16px] font-bold">{t}</h3>
            <p className="mb-4 text-[13.5px] text-ink-mute">{d}</p>
            <Button loading={busy === k} onClick={() => get(k, path, file)}><Download size={16} />Download</Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
