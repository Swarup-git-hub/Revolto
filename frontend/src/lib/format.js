const dt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const d = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
export const fmtDateTime = (v) => (v ? dt.format(new Date(v)) : "—");
export const fmtDate = (v) => (v ? d.format(new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00` : v)) : "—");
export const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const ROLE_LABEL = { student: "Student", guide: "Guide", coordinator: "Coordinator", hod: "HOD" };
export const roleHome = () => "/";
