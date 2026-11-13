import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./components/layout/AppShell.jsx";
import { Toaster } from "./components/layout/Toaster.jsx";
import { api } from "./lib/api.js";
import { useAuth } from "./store/auth.js";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Teams from "./pages/Teams.jsx";
import TeamDetail from "./pages/TeamDetail.jsx";
import MyProject from "./pages/MyProject.jsx";
import ReviewQueue from "./pages/ReviewQueue.jsx";
import Bookings from "./pages/Bookings.jsx";
import Reports from "./pages/Reports.jsx";
import People from "./pages/admin/People.jsx";
import Sections from "./pages/admin/Sections.jsx";
import Imports from "./pages/admin/Imports.jsx";
import ReviewSetup from "./pages/admin/ReviewSetup.jsx";
import SettingsPage from "./pages/admin/Settings.jsx";
import Audit from "./pages/admin/Audit.jsx";

function Guard({ roles, children }) {
  const user = useAuth((s) => s.user);
  return roles.includes(user.role) ? children : <Navigate to="/" replace />;
}
function Private() {
  const token = useAuth((s) => s.token);
  return token ? <AppShell /> : <Navigate to="/login" replace />;
}

export default function App() {
  const { token, setUser, clear } = useAuth();
  // Refresh the profile on load so role/team changes made by an administrator are picked up.
  useEffect(() => {
    if (!token) return;
    api.get("/auth/me").then((r) => setUser(r.data.user)).catch(() => {});
  }, [token, setUser, clear]);

  const staff = ["guide", "coordinator", "hod"];
  const admins = ["coordinator", "hod"];
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Private />}>
          <Route index element={<Dashboard />} />
          <Route path="my-project" element={<Guard roles={["student"]}><MyProject /></Guard>} />
          <Route path="teams" element={<Guard roles={staff}><Teams /></Guard>} />
          <Route path="teams/:id" element={<TeamDetail />} />
          <Route path="queue" element={<Guard roles={["guide"]}><ReviewQueue /></Guard>} />
          <Route path="bookings" element={<Bookings />} />
          <Route path="reports" element={<Guard roles={staff}><Reports /></Guard>} />
          <Route path="people" element={<Guard roles={admins}><People /></Guard>} />
          <Route path="sections" element={<Guard roles={["hod"]}><Sections /></Guard>} />
          <Route path="imports" element={<Guard roles={admins}><Imports /></Guard>} />
          <Route path="review-setup" element={<Guard roles={admins}><ReviewSetup /></Guard>} />
          <Route path="settings" element={<Guard roles={["hod"]}><SettingsPage /></Guard>} />
          <Route path="audit" element={<Guard roles={["hod"]}><Audit /></Guard>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {!token && <Toaster />}
    </BrowserRouter>
  );
}
