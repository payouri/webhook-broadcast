import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Same-origin proxy for the admin API in dev: the HttpOnly session cookie
// (ADR 0005) only travels with same-site requests, so the dashboard talks to
// the API through this origin rather than cross-origin to :8080.
const adminApiProxy = {
  target: "http://localhost:8080",
  changeOrigin: true,
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/auth": adminApiProxy,
      "/channels": adminApiProxy,
      "/broadcasts": adminApiProxy,
      "/deliveries": adminApiProxy,
    },
  },
});
