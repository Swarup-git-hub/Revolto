import { create } from "zustand";

let n = 0;
export const useToast = create((set) => ({
  toasts: [],
  push: (kind, message) => {
    const id = ++n;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, message }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === "error" ? 7000 : 4000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
export const toast = { success: (m) => useToast.getState().push("success", m), error: (m) => useToast.getState().push("error", m) };
