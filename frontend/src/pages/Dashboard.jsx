import { AlertTriangle, CalendarCheck, ClipboardCheck, FileCheck2, Layers, Users, UserCheck } from "lucide-react";
import { Link } from "react-router-dom";
import ProgressSummary from "../components/reviews/ProgressSummary.jsx";
import { Alert, Async, Card, EmptyState, PageHeader, ProgressBar, Stat, StatusBadge } from "../components/ui/index.jsx";
import { api } from "../lib/api.js";
import { fmtDate } from "../lib/format.js";
import { useLoad } from "../lib/hooks.js";
import { useAuth } from "../store/auth.js";

function StudentDash({ d }) {
  if (!d.team) return <Card><EmptyState icon={Users} title="You are not part of a team yet" hint="Your coordinator or guide will add you to a team. Once that happens your project, reviews and contributions will appear here." /></Card>;
  const t = d.team;
  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[13px] font-semibold text-ink-mute">Team {t.teamId} · Section {t.section} · Guide: {t.guide}</div>
            <h2 className="mt-1 text-[22px] font-bold">{t.projectTitle || "Project title not submitted yet"}</h2>
            <div className="mt-2 flex items-center gap-2"><StatusBadge status={t.titleStatus === "not_submitted" ? "not_submitted" : t.titleStatus} label={`Title: ${t.titleStatus.replace("_", " ")}`} />{t.isLeader && <span className="text-[13px] font-semibold text-slate-deep">You are the team leader</span>}</div>
          </div>
          <Link to="/my-project" className="btn-primary">Open my project</Link>
        </div>
      </Card>

      {d.corrections.length > 0 && (
        <Alert tone="warning">
          <strong>Your guide requested changes</strong> on: {d.corrections.map((c) => c.name.split("—")[0].trim()).join(", ")}. {t.isLeader ? "Open the review to correct and resubmit." : "The team leader can resubmit."} <Link to="/my-project" className="font-semibold underline">Go to my project</Link>
        </Alert>
      )}

      <ProgressSummary progress={d.progress} />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 text-[16px] font-bold">Team contributions</h3>
          <ul className="space-y-2">
            {d.progress.members.map((m) => (
              <li key={m.id} className="well flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span className="text-[14.5px] font-semibold">{m.name} <span className="text-[12.5px] font-normal text-ink-mute">{m.rollNumber}</span></span>
                <StatusBadge status={m.contributionStatus} />
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12.5px] text-ink-mute">Contributions are self-reported and marked "acknowledged" only after your guide reviews them.</p>
        </Card>
        {d.bookingEnabled && (
          <Card>
            <h3 className="mb-3 text-[16px] font-bold">Review slot bookings</h3>
            {d.bookings.length ? (
              <ul className="space-y-2">{d.bookings.map((b) => <li key={b.id} className="well flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[14px]"><span><strong>{b.reviewKey.replace("-", " ")}</strong> · {fmtDate(b.date)} {b.start}–{b.end}</span><StatusBadge status={b.status} /></li>)}</ul>
            ) : <p className="text-[14px] text-ink-mute">No slot requested yet.</p>}
            <Link to="/bookings" className="btn-soft btn-sm mt-4">Find a slot</Link>
          </Card>
        )}
      </div>
    </div>
  );
}

function StaffDash({ d, role }) {
  const reviewDist = Object.entries(d.teamsByCurrentReview || {}).filter(([k, n]) => n > 0 && k !== "not_started");
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={Users} label="Active teams" value={d.teamCount} />
        <Stat icon={ClipboardCheck} label="Awaiting guide review" value={d.awaitingGuideReview} hint={`${d.contributionsPending} contribution(s) pending`} />
        {role === "guide" ? <Stat icon={AlertTriangle} label="Awaiting team correction" value={d.awaitingCorrection} /> : <Stat icon={UserCheck} label="Students" value={d.studentCount} />}
        <Stat icon={CalendarCheck} label="Pending slot requests" value={d.pendingBookings} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h3 className="mb-1 text-[16px] font-bold">Where teams are now</h3>
          <p className="mb-4 text-[13px] text-ink-mute">First review not yet approved, per team.</p>
          {reviewDist.length ? (
            <div className="space-y-3">{reviewDist.map(([k, n]) => <ProgressBar key={k} label={k === "all_approved" ? "All reviews approved" : k.replace("-", " ").replace(/^./, (c) => c.toUpperCase())} value={n} max={d.teamCount} caption={`${n} team${n > 1 ? "s" : ""}`} />)}</div>
          ) : <p className="text-[14px] text-ink-mute">No teams yet.</p>}
          <div className="mt-4 flex flex-wrap gap-4 text-[13.5px] text-ink-soft">
            <span><FileCheck2 size={14} className="mr-1 inline" />{d.reportsApproved} final report(s) approved</span>
            <span>{d.teamsWithoutMilestoneRecord} team(s) without a milestone update</span>
          </div>
        </Card>

        {role === "guide" ? (
          <Card>
            <h3 className="mb-3 text-[16px] font-bold">Upcoming sessions</h3>
            {d.upcomingSessions?.length ? <ul className="space-y-2">{d.upcomingSessions.map((s) => <li key={s.id} className="well flex items-center justify-between gap-2 px-4 py-3 text-[14px]"><strong>{s.team}</strong><span>{fmtDate(s.date)} · {s.start}–{s.end}</span></li>)}</ul> : <EmptyState title="No approved sessions" hint="Approved slot bookings will appear here." />}
            <div className="mt-4 flex gap-2"><Link to="/queue" className="btn-primary btn-sm">Open review queue</Link><Link to="/bookings" className="btn-soft btn-sm">Slots & bookings</Link></div>
          </Card>
        ) : (
          <Card>
            <h3 className="mb-3 flex items-center gap-2 text-[16px] font-bold"><Layers size={17} />Sections</h3>
            {d.sections?.length ? (
              <div className="overflow-x-auto"><table className="w-full text-[14px]"><thead><tr><th className="th">Section</th><th className="th">Teams</th><th className="th">Reviews approved</th><th className="th">Reports approved</th></tr></thead>
                <tbody>{d.sections.map((s) => <tr key={s.id} className="border-t border-white/70"><td className="td font-semibold">{s.name}</td><td className="td">{s.teams}</td><td className="td">{s.reviewsApproved} of {s.reviewsTotal}</td><td className="td">{s.reportsApproved}</td></tr>)}</tbody></table></div>
            ) : <EmptyState title="No sections" hint="Sections will appear here once they are created." />}
            <div className="mt-4 flex flex-wrap gap-2"><Link to="/teams" className="btn-primary btn-sm">View teams</Link><Link to="/reports" className="btn-soft btn-sm">Export reports</Link></div>
          </Card>
        )}
      </div>
      <p className="text-[12.5px] text-ink-mute">Review stages and milestone progress are reported separately and reflect recorded data only. Advanced analytics are not part of this release.</p>
    </div>
  );
}

export default function Dashboard() {
  const user = useAuth((s) => s.user);
  const state = useLoad(() => api.get("/dashboard").then((r) => r.data), []);
  return (
    <div className="rise">
      <PageHeader title={`Welcome, ${user.name.split(" ")[0]}`} subtitle={user.role === "student" ? "Your project, reviews and feedback at a glance." : user.role === "guide" ? "Teams you guide and the work waiting for you." : "Recorded progress and review status across your scope."} />
      <Async state={state} rows={4}>{(d) => (user.role === "student" ? <StudentDash d={d} /> : <StaffDash d={d} role={user.role} />)}</Async>
    </div>
  );
}
