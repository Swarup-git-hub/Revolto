import { Card, ProgressBar, StatusBadge } from "../ui/index.jsx";
import ReviewTimeline from "./ReviewTimeline.jsx";

/**
 * Two deliberately separate indicators:
 *  - review stages  : how many reviews the guide has approved
 *  - milestones     : items the team has reported as completed in its latest progress checklist
 * They are never merged into one percentage.
 */
export default function ProgressSummary({ progress, onSelect, selectedKey }) {
  const m = progress.milestones;
  return (
    <div className="space-y-5">
      <ReviewTimeline reviews={progress.reviews} currentKey={progress.currentReview?.key} onSelect={onSelect} selectedKey={selectedKey} />
      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <h3 className="mb-0.5 text-[15px] font-bold">Review stages</h3>
          <p className="mb-4 text-[13px] text-ink-mute">How many reviews your guide has approved.</p>
          <ProgressBar label="Reviews approved" value={progress.reviewsApproved} max={progress.reviewsTotal} tone="sage" />
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[13.5px] text-ink-soft">
            {progress.reviewsSubmitted} of {progress.reviewsTotal} submitted
            {progress.currentReview ? <>· Current: <strong>{progress.currentReview.name.split("—")[0].trim()}</strong> <StatusBadge status={progress.currentReview.status} /></> : <>· All reviews approved</>}
          </div>
        </Card>
        <Card>
          <h3 className="mb-0.5 text-[15px] font-bold">Project milestones</h3>
          <p className="mb-4 text-[13px] text-ink-mute">As reported by the team in its latest progress update.</p>
          {m.recorded ? (
            <>
              <ProgressBar label="Milestones completed" value={m.completed} max={m.total} />
              <div className="mt-3 text-[13.5px] text-ink-soft">{m.inProgress} in progress · {m.total - m.completed - m.inProgress} not started</div>
            </>
          ) : (
            <div className="well px-4 py-5 text-center text-[14px] text-ink-mute">No milestone progress has been reported yet.</div>
          )}
        </Card>
      </div>
    </div>
  );
}
