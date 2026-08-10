import { createServer, type Server } from "node:http";
import { healthResponseSchema } from "@webhook-broadcast/contract";

/**
 * Plain node:http liveness probe for the worker process — no Koa dependency
 * needed for a single static route (ADR 0008: worker exposes /health on
 * WORKER_HEALTH_PORT).
 */
export function createHealthServer(): Server {
  return createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      const body = JSON.stringify(healthResponseSchema.parse({ status: "ok" }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(body);
      return;
    }
    res.writeHead(404);
    res.end();
  });
}
