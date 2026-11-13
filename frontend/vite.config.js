import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The API is proxied in dev and preview, so the browser talks to a single origin and needs no CORS setup.
const target = process.env.VITE_DEV_API || "http://localhost:5000";
const proxy = { "/api": { target, changeOrigin: true }, "/socket.io": { target, ws: true } };

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
  build: { sourcemap: false, chunkSizeWarningLimit: 700 },
});
