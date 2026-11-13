import { CheckCircle2, CircleDashed, Clock, Eye, RotateCcw } from "lucide-react";
import { cx } from "../ui/index.jsx";

const VIEW = {
  approved: { Icon: CheckCircle2, text: "Approved", cls: "text-sage-ink", ring: "ring-sage/40" },
  submitted: { Icon: Eye, text: "Submitted", cls: "text-slate-deep", ring: "ring-slate-brand/30" },
  under_review: { Icon: Clock, text: "Under review", cls: "text-slate-deep", ring: "ring-slate-brand/30" },
  changes_required: { Icon: RotateCcw, text: "Changes required", cls: "text-amber-ink", ring: "ring-amber-clay/40" },
  not_submitted: { Icon: CircleDashed, text: "Not submitted", cls: "text-ink-mute", ring: "ring-transparent" },
};
const short = (name) => name.split("—")[1]?.trim() || name;

/** Review 1 → Review 2 → Review 3 → Final report. Each stop shows an icon and a text status (never colour alone). */
export default function ReviewTimeline({ reviews, currentKey, selectedKey, onSelect }) {
  return (
    <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Review timeline">
      {reviews.map((r, i) => {
        const v = VIEW[r.status] || VIEW.not_submitted;
        const isCurrent = r.key === currentKey;
        const Tag = onSelect ? "button" : "div";
        return (
          <li key={r.key} className="relative">
            {i < reviews.length - 1 && <span aria-hidden className="well absolute left-[calc(100%-2px)] top-1/2 hidden h-2 w-4 -translate-y-1/2 lg:block" />}
            <Tag type={onSelect ? "button" : undefined} onClick={onSelect ? () => onSelect(r.key) : undefined}
              aria-current={isCurrent ? "step" : undefined}
              className={cx("clay-sm block h-full w-full p-4 text-left transition-all", onSelect && "hover:-translate-y-0.5", selectedKey === r.key && "ring-2 ring-slate-brand", isCurrent && selectedKey !== r.key && "ring-2", isCurrent && v.ring)}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[12.5px] font-bold uppercase tracking-wide text-ink-mute">{r.type === "report" ? "Final report" : `Review ${r.order}`}</span>
                {isCurrent && <span className="rounded-full bg-slate-tint px-2 py-0.5 text-[11px] font-bold text-slate-deep">Current</span>}
              </div>
              <div className="min-h-[2.8em] text-[14.5px] font-semibold leading-snug text-ink">{short(r.name)}</div>
              <div className={cx("mt-2.5 flex items-center gap-1.5 text-[13px] font-semibold", v.cls)}>
                <v.Icon size={16} aria-hidden />{v.text}{r.version > 1 ? <span className="font-normal text-ink-mute"> · v{r.version}</span> : null}
              </div>
              {r.isLate && <div className="mt-1 text-[12px] font-semibold text-amber-ink">Submitted after the deadline</div>}
            </Tag>
          </li>
        );
      })}
    </ol>
  );
}
