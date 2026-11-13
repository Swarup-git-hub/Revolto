import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import { useToast } from "../../store/toast.js";
import { cx } from "../ui/index.jsx";

export function Toaster() {
  const { toasts, dismiss } = useToast();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} role={t.kind === "error" ? "alert" : "status"} className={cx("clay-sm rise pointer-events-auto flex items-start gap-2.5 p-3.5 text-[14px]", t.kind === "error" ? "text-brick-ink" : "text-sage-ink")}>
          {t.kind === "error" ? <AlertTriangle size={18} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={18} className="mt-0.5 shrink-0" />}
          <span className="flex-1 font-medium">{t.message}</span>
          <button className="rounded-full p-0.5 hover:bg-white/60" aria-label="Dismiss" onClick={() => dismiss(t.id)}><X size={15} /></button>
        </div>
      ))}
    </div>
  );
}
