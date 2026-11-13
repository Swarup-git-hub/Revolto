import { useId } from "react";
import { cx } from "./index.jsx";

export function Field({ label, error, help, required, children, className }) {
  return (
    <div className={className}>
      {label && <span className="label">{label}{required && <span className="text-brick" aria-hidden> *</span>}</span>}
      {children}
      {help && !error && <p className="help">{help}</p>}
      {error && <p className="err" role="alert">{error}</p>}
    </div>
  );
}

export function Input({ label, error, help, required, className, ...rest }) {
  const id = useId();
  return (
    <div className={className}>
      {label && <label htmlFor={id} className="label">{label}{required && <span className="text-brick" aria-hidden> *</span>}</label>}
      <input id={id} className="field" aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-e` : undefined} required={required} {...rest} />
      {help && !error && <p className="help">{help}</p>}
      {error && <p id={`${id}-e`} className="err" role="alert">{error}</p>}
    </div>
  );
}

export function Textarea({ label, error, help, required, rows = 4, className, ...rest }) {
  const id = useId();
  return (
    <div className={className}>
      {label && <label htmlFor={id} className="label">{label}{required && <span className="text-brick" aria-hidden> *</span>}</label>}
      <textarea id={id} rows={rows} className="field resize-y" aria-invalid={Boolean(error)} required={required} {...rest} />
      {help && !error && <p className="help">{help}</p>}
      {error && <p className="err" role="alert">{error}</p>}
    </div>
  );
}

export function Select({ label, error, help, required, options, placeholder, className, ...rest }) {
  const id = useId();
  return (
    <div className={className}>
      {label && <label htmlFor={id} className="label">{label}{required && <span className="text-brick" aria-hidden> *</span>}</label>}
      <select id={id} className={cx("field appearance-none pr-9")} aria-invalid={Boolean(error)} required={required} {...rest}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {help && !error && <p className="help">{help}</p>}
      {error && <p className="err" role="alert">{error}</p>}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }) {
  return (
    <label className={cx("flex cursor-pointer items-start gap-3", disabled && "cursor-not-allowed opacity-60")}>
      <span className={cx("well relative mt-0.5 inline-block h-7 w-12 shrink-0 p-[3px]")}>
        <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className={cx("block h-full w-[22px] rounded-full shadow-clay-sm transition-all", checked ? "translate-x-5 bg-gradient-to-br from-[#4B6E8A] to-[#385670]" : "translate-x-0 bg-[#F4F6F5]")} />
        <span className="absolute inset-0 rounded-well peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-slate-brand" />
      </span>
      <span>
        <span className="block text-[14.5px] font-semibold text-ink">{label}</span>
        {hint && <span className="block text-[13px] text-ink-mute">{hint}</span>}
        <span className="sr-only">{checked ? "On" : "Off"}</span>
      </span>
    </label>
  );
}

export function SearchBox({ value, onChange, placeholder = "Search" }) {
  return <input type="search" className="field !w-64 max-w-full" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />;
}
