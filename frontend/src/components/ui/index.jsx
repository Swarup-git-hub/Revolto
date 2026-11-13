import { AlertTriangle, CheckCircle2, Circle, Clock, Eye, FileX2, Inbox, Loader2, RotateCcw, XCircle, MinusCircle, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";

export const cx = (...a) => a.filter(Boolean).join(" ");

export function Card({ className, children, as: Tag = "section", ...rest }) {
  return <Tag className={cx("clay p-5 sm:p-6", className)} {...rest}>{children}</Tag>;
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[26px] font-bold leading-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-[15px] text-ink-soft">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Button({ variant = "primary", size, loading, children, className, ...rest }) {
  return (
    <button type="button" className={cx(`btn-${variant}`, size === "sm" && "btn-sm", className)} disabled={loading || rest.disabled} {...rest}>
      {loading && <Loader2 size={16} className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/* Status badges always carry an icon AND text so meaning never depends on colour alone. */
const TONES = {
  neutral: ["bg-stone-tint text-ink-soft", Circle],
  info: ["bg-slate-tint text-slate-deep", Eye],
  progress: ["bg-slate-tint text-slate-deep", Clock],
  success: ["bg-sage-tint text-sage-ink", CheckCircle2],
  warning: ["bg-amber-tint text-amber-ink", AlertTriangle],
  danger: ["bg-brick-tint text-brick-ink", XCircle],
  muted: ["bg-stone-tint text-ink-mute", MinusCircle],
};
const STATUS = {
  not_submitted: ["Not submitted", "muted"], submitted: ["Submitted", "info"], under_review: ["Under review", "progress"], changes_required: ["Changes required", "warning"],
  approved: ["Approved", "success"], superseded: ["Superseded", "muted"],
  not_started: ["Not started", "muted"], in_progress: ["In progress", "progress"], completed: ["Completed", "success"],
  confirmed: ["Confirmed", "success"],
  pending_review: ["Pending review", "info"], acknowledged: ["Acknowledged by guide", "success"], not_recorded: ["Not recorded", "muted"],
  pending: ["Pending approval", "info"], rejected: ["Rejected", "danger"], cancelled: ["Cancelled", "muted"],
  available: ["Available", "success"], booked: ["Booked", "neutral"], disabled: ["Disabled", "muted"],
};
export function StatusBadge({ status, label, className }) {
  const [text, tone] = STATUS[status] || [String(status || "—").replace(/_/g, " "), "neutral"];
  const [cls, Icon] = TONES[tone];
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[12.5px] font-semibold", cls, className)}>
      <Icon size={13} aria-hidden />
      {label || text}
    </span>
  );
}
export const Tag = ({ children, tone = "neutral" }) => <span className={cx("rounded-full px-2.5 py-0.5 text-[12px] font-semibold", TONES[tone][0])}>{children}</span>;

/* ---------- loading / empty / error ---------- */
export const Skeleton = ({ className }) => <div className={cx("shimmer rounded-well", className)} aria-hidden />;

export function LoadingBlock({ rows = 3 }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
    </div>
  );
}

export function EmptyState({ title, hint, action, icon: Icon = Inbox }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <div className="well grid h-14 w-14 place-items-center rounded-full text-ink-mute"><Icon size={24} aria-hidden /></div>
      <p className="mt-1 text-[16px] font-semibold text-ink">{title}</p>
      {hint && <p className="max-w-md text-[14px] text-ink-soft">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-6 py-8 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-full bg-brick-tint text-brick-ink"><FileX2 size={22} aria-hidden /></div>
      <p className="max-w-md text-[15px] font-medium text-ink">{message || "We could not load this."}</p>
      {onRetry && <Button variant="soft" size="sm" onClick={onRetry}><RotateCcw size={14} aria-hidden />Try again</Button>}
    </div>
  );
}

/** Renders loading skeleton, error with retry, empty state, or children(data). */
export function Async({ state, empty, rows, children, isEmpty }) {
  if (state.loading) return <LoadingBlock rows={rows} />;
  if (state.error) return <ErrorState message={state.error} onRetry={state.retry} />;
  if (isEmpty ? isEmpty(state.data) : false) return empty;
  return children(state.data);
}

export function Alert({ tone = "info", children, className }) {
  const [cls, Icon] = TONES[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("flex items-start gap-2.5 rounded-well px-4 py-3 text-[14px]", cls, className)}>
      <Icon size={17} className="mt-0.5 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

/* ---------- progress ---------- */
export function ProgressBar({ value, max, label, caption, tone = "slate" }) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  const fill = tone === "sage" ? "from-[#5E9A7C] to-[#3F7058]" : "from-[#5A7F9C] to-[#3F5F7A]";
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-semibold text-ink-soft">{label}</span>
        <span className="text-[13px] font-semibold text-ink">{caption ?? `${value} of ${max}`}</span>
      </div>
      <div className="well h-3.5 overflow-hidden p-[3px]" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
        <div className={cx("h-full rounded-full bg-gradient-to-r transition-[width] duration-500", fill)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Stat({ label, value, hint, icon: Icon }) {
  return (
    <div className="clay-sm flex items-center gap-3.5 p-4">
      {Icon && <div className="well grid h-11 w-11 shrink-0 place-items-center text-slate-brand"><Icon size={20} aria-hidden /></div>}
      <div className="min-w-0">
        <div className="text-[26px] font-bold leading-none text-ink">{value}</div>
        <div className="mt-1 text-[13px] font-semibold text-ink-soft">{label}</div>
        {hint && <div className="text-[12px] text-ink-mute">{hint}</div>}
      </div>
    </div>
  );
}

/* ---------- tabs ---------- */
export function Tabs({ tabs, value, onChange }) {
  return (
    <div role="tablist" className="well mb-5 inline-flex max-w-full gap-1 overflow-x-auto p-1.5">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} type="button" onClick={() => onChange(t.id)}
          className={cx("whitespace-nowrap rounded-[11px] px-3.5 py-2 text-[14px] font-semibold transition-all", value === t.id ? "clay-sm text-slate-deep" : "text-ink-soft hover:text-ink")}>
          {t.label}{t.badge ? <span className="ml-2 rounded-full bg-amber-tint px-1.5 text-[11.5px] text-amber-ink">{t.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

/* ---------- modal & confirm ---------- */
export function Modal({ open, onClose, title, children, footer, wide }) {
  const ref = useRef(null);
  const id = useId();
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.activeElement;
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    setTimeout(() => ref.current?.querySelector("input,textarea,select,button")?.focus(), 30);
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#2a3a36]/35 p-4 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} className={cx("clay rise w-full p-6", wide ? "max-w-3xl" : "max-w-lg")}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id={id} className="text-[19px] font-bold text-ink">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close dialog" className="btn-ghost rounded-full p-1.5"><X size={18} /></button>
        </div>
        <div>{children}</div>
        {footer && <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = "Confirm", danger, loading, confirmDisabled, onConfirm, onClose, children }) {
  return (
    <Modal open={open} onClose={onClose} title={title}
      footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button variant={danger ? "danger" : "primary"} loading={loading} disabled={confirmDisabled} onClick={onConfirm}>{confirmLabel}</Button></>}>
      {message && <p className="text-[15px] text-ink-soft">{message}</p>}
      {children}
    </Modal>
  );
}

/** Server-side pagination controls. `page` is 1-based; the parent owns the page state and resets it when filters change. */
export function Pager({ page, limit, total, onPage, label = "records" }) {
  if (!total) return null;
  const pages = Math.max(1, Math.ceil(total / limit));
  const from = (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  return (
    <nav aria-label="Pagination" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[13.5px] text-ink-soft">
      <span aria-live="polite">Showing {from}–{to} of {total} {label}</span>
      {pages > 1 && (
        <span className="flex items-center gap-2">
          <Button variant="soft" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
          <span className="px-1">Page {page} of {pages}</span>
          <Button variant="soft" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
        </span>
      )}
    </nav>
  );
}
