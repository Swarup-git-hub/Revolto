import axios from "axios";
import { useAuth } from "../store/auth.js";
import { useToast } from "../store/toast.js";

export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || "/api", timeout: 30000 });

api.interceptors.request.use((cfg) => {
  const token = useAuth.getState().token;
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && useAuth.getState().token) {
      useAuth.getState().clear();
      useToast.getState().push("error", "Your session has ended. Please sign in again.");
    }
    return Promise.reject(err);
  }
);

/** Turns any failure into { message, fields } for display next to forms. */
export function describeError(err) {
  const data = err?.response?.data;
  if (data?.error) return { message: data.error, fields: data.details && typeof data.details === "object" ? data.details : {} };
  if (err?.code === "ECONNABORTED") return { message: "The server took too long to respond. Please try again.", fields: {} };
  if (!err?.response) return { message: "Cannot reach the server. Check your connection and try again.", fields: {} };
  return { message: "Something went wrong. Please try again.", fields: {} };
}

export async function download(path, filename) {
  const res = await api.get(path, { responseType: "blob" });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
