import { io } from "socket.io-client";

let socket = null;
export function connectSocket(token, onNotification) {
  disconnectSocket();
  const base = import.meta.env.VITE_API_URL ? new URL(import.meta.env.VITE_API_URL, window.location.origin).origin : window.location.origin;
  socket = io(base, { auth: { token }, transports: ["websocket", "polling"], reconnectionAttempts: 5 });
  socket.on("notification", onNotification);
  socket.on("connect_error", () => {});
}
export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
