import type { IncomingMessage } from "node:http";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Same-origin proxy for the admin API in dev: the HttpOnly session cookie
// (ADR 0005) only travels with same-site requests, so the dashboard talks to
// the API through this origin rather than cross-origin to :8080.
//
// This path space overlaps the client-side router (issue #42: a Channel's own
// URL is /channels/:id, with /:tab and /:broadcastId beyond it) — a hard
// reload on one of those URLs is a browser navigation, not an API call, and
// must fall through to the SPA shell rather than hit the admin API and get a
// JSON 404. Browser navigations always send `Accept: text/html…`; this app's
// own fetch calls never do, so branch on that instead of the path (mirrors
// nginx.conf.template's production equivalent).
const adminApiProxy = {
  target: "http://localhost:8080",
  changeOrigin: true,
  bypass(req: IncomingMessage) {
    if (req.headers.accept?.includes("text/html")) {
      return "/index.html";
    }
  },
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
      // `/ingest` is proxied too (issue #47) so the ingest URL the dashboard
      // shows — built from this origin, `apps/web/src/lib/ingestUrl.ts` —
      // actually resolves in dev, mirroring nginx.conf.template. It gets no `bypass`:
      // /ingest is not a client-side route, so a producer that advertises
      // `Accept: text/html` must still reach the api and get its 202 rather
      // than a 200 SPA shell that swallows the Broadcast.
      "/ingest": { target: "http://localhost:8080", changeOrigin: true },
    },
  },
});
