import { createServer, type Server } from "node:http";
import { healthResponseSchema } from "@webhook-broadcast/contract";

export interface HealthServerDeps {
  renderMetrics?: () => Promise<string>;
}

/**
 * Plain node:http liveness probe for the worker process — no Koa dependency
 * needed for a single static route (ADR 0008: worker exposes /health on
 * WORKER_HEALTH_PORT, plus `/metrics` per ADR 0009).
 */
export function createHealthServer(deps: HealthServerDeps = {}): Server {
  return createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      const body = JSON.stringify(healthResponseSchema.parse({ status: "ok" }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(body);
      return;
    }
    if (req.method === "GET" && req.url === "/metrics" && deps.renderMetrics) {
      try {
        const body = await deps.renderMetrics();
        res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
        res.end(body);
      } catch (error) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(error instanceof Error ? error.message : String(error));
      }
      return;
    }
    res.writeHead(404);
    res.end();
  });
}
