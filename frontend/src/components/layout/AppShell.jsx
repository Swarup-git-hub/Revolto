import { Bell, CalendarClock, ClipboardCheck, FileSpreadsheet, GraduationCap, History, LayoutDashboard, Layers, ListChecks, LogOut, Menu, Settings, Upload, Users, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../../lib/api.js";
import { ROLE_LABEL, fmtDateTime } from "../../lib/format.js";
import { connectSocket, disconnectSocket } from "../../lib/socket.js";
import { useAuth } from "../../store/auth.js";
import { cx } from "../ui/index.jsx";
import { Toaster } from "./Toaster.jsx";

const NAV = {
  student: [["/", "Dashboard", LayoutDashboard], ["/my-project", "My project", GraduationCap], ["/bookings", "Review slots", CalendarClock]],
  guide: [["/", "Dashboard", LayoutDashboard], ["/teams", "My teams", Users], ["/queue", "Review queue", ClipboardCheck], ["/bookings", "Slots & bookings", CalendarClock], ["/reports", "Reports", FileSpreadsheet]],
  coordinator: [["/", "Dashboard", LayoutDashboard], ["/teams", "Teams", Users], ["/people", "People", GraduationCap], ["/bookings", "Slots & bookings", CalendarClock], ["/review-setup", "Review setup", ListChecks], ["/imports", "Imports", Upload], ["/reports", "Reports", FileSpreadsheet]],
  hod: [["/", "Dashboard", LayoutDashboard], ["/teams", "Teams", Users], ["/people", "People", GraduationCap], ["/sections", "Sections", Layers], ["/bookings", "Slots & bookings", CalendarClock], ["/review-setup", "Review setup", ListChecks], ["/imports", "Imports", Upload], ["/reports", "Reports", FileSpreadsheet], ["/settings", "Settings", Settings], ["/audit", "Audit log", History]],
};

function Bell_() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ notifications: [], unread: 0 });
  const token = useAuth((s) => s.token);
  const navigate = useNavigate();
  const load = useCallback(() => api.get("/notifications").then((r) => setData(r.data)).catch(() => {}), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 90000);
    connectSocket(token, load);
    return () => { clearInterval(t); disconnectSocket(); };
  }, [token, load]);
  const markAll = async () => { await api.post("/notifications/read-all"); load(); };
  const openItem = async (n) => { if (!n.isRead) await api.post(`/notifications/${n.id}/read`).catch(() => {}); setOpen(false); load(); if (n.link) navigate(n.link.replace(/^\/teams\//, "/teams/")); };
  return (
    <div className="relative">
      <button type="button" className="btn-soft relative !rounded-full !p-2.5" aria-label={`Notifications, ${data.unread} unread`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Bell size={18} />
        {data.unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-brick px-1 text-[11px] font-bold text-white">{data.unread > 9 ? "9+" : data.unread}</span>}
      </button>
      {open && (
        <div className="clay absolute right-0 z-40 mt-3 w-[min(92vw,380px)] p-3">
          <div className="mb-2 flex items-center justify-between px-2"><h2 className="text-[15px] font-bold">Notifications</h2>{data.unread > 0 && <button className="text-[13px] font-semibold text-slate-brand underline" onClick={markAll}>Mark all as read</button>}</div>
          <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
            {data.notifications.length === 0 && <li className="px-3 py-6 text-center text-[14px] text-ink-mute">You are all caught up.</li>}
            {data.notifications.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => openItem(n)} className={cx("w-full rounded-well px-3 py-2.5 text-left hover:bg-white/60", !n.isRead && "bg-slate-tint/60")}>
                  <span className="flex items-center gap-2 text-[14px] font-semibold">{!n.isRead && <span className="h-2 w-2 rounded-full bg-slate-brand" aria-label="Unread" />}{n.title}</span>
                  <span className="block text-[13px] text-ink-soft">{n.message}</span>
                  <span className="block text-[12px] text-ink-mute">{fmtDateTime(n.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function AppShell() {
  const { user, clear, token } = useAuth();
  const [menu, setMenu] = useState(false);
  const loc = useLocation();
  useEffect(() => setMenu(false), [loc.pathname]);
  const signOut = async () => { try { await api.post("/auth/logout"); } catch { /* token may already be invalid */ } clear(); };
  const items = NAV[user.role] || [];

  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-1.5">
      {items.map(([to, label, Icon]) => (
        <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => cx("flex items-center gap-3 rounded-well px-3.5 py-2.5 text-[14.5px] font-semibold transition-all", isActive ? "well text-slate-deep" : "text-ink-soft hover:bg-white/55 hover:text-ink")}>
          <Icon size={18} aria-hidden />{label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[272px_1fr] lg:gap-6 lg:p-5">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-well focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
      <aside className="hidden lg:block">
        <div className="clay sticky top-5 flex max-h-[calc(100vh-40px)] flex-col gap-6 overflow-y-auto p-5">
          <Link to="/" className="flex items-center gap-3">
            <span className="well grid h-11 w-11 place-items-center text-slate-brand"><GraduationCap size={22} /></span>
            <span className="text-[15px] font-bold leading-tight">Review<br />Management</span>
          </Link>
          {nav}
          <div className="well mt-2 p-3.5">
            <div className="truncate text-[14px] font-bold">{user.name}</div>
            <div className="text-[12.5px] text-ink-mute">{ROLE_LABEL[user.role]}{user.rollNumber ? ` · ${user.rollNumber}` : ""}</div>
            <button type="button" onClick={signOut} className="mt-2.5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-brick-ink hover:underline"><LogOut size={14} />Sign out</button>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <div className="flex items-center justify-between gap-3 px-4 py-3 lg:px-1 lg:pb-5 lg:pt-0">
          <button type="button" className="btn-soft !p-2.5 lg:hidden" aria-label="Open menu" onClick={() => setMenu(true)}><Menu size={20} /></button>
          <div className="hidden text-[13.5px] text-ink-mute lg:block">Signed in as <span className="font-semibold text-ink-soft">{user.email}</span></div>
          <div className="flex items-center gap-2">{token && <Bell_ />}</div>
        </div>
        <main id="main" className="px-4 pb-16 lg:px-1"><Outlet /></main>
      </div>

      {menu && (
        <div className="fixed inset-0 z-50 bg-[#2a3a36]/35 lg:hidden" onMouseDown={(e) => e.target === e.currentTarget && setMenu(false)}>
          <div className="clay h-full w-[290px] max-w-[85vw] overflow-y-auto !rounded-l-none p-5">
            <div className="mb-5 flex items-center justify-between"><span className="text-[16px] font-bold">Review Management</span><button className="btn-ghost !p-2" aria-label="Close menu" onClick={() => setMenu(false)}><X size={18} /></button></div>
            {nav}
            <button type="button" onClick={signOut} className="btn-soft mt-6 w-full"><LogOut size={16} />Sign out</button>
          </div>
        </div>
      )}
      <Toaster />
    </div>
  );
}
