import { create } from "zustand";

const KEY = "rms.session";
const read = () => {
  try { return JSON.parse(sessionStorage.getItem(KEY)) || {}; } catch { return {}; }
};

/** The token lives in sessionStorage (cleared when the tab closes) rather than localStorage. */
export const useAuth = create((set) => ({
  token: read().token || null,
  user: read().user || null,
  login: (token, user) => { sessionStorage.setItem(KEY, JSON.stringify({ token, user })); set({ token, user }); },
  setUser: (user) => set((s) => { sessionStorage.setItem(KEY, JSON.stringify({ token: s.token, user })); return { user }; }),
  clear: () => { sessionStorage.removeItem(KEY); set({ token: null, user: null }); },
}));
