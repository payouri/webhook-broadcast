import { createServer } from "node:http";
import { createDb } from "@webhook-broadcast/db";
import { bootEnv } from "./config.js";
import { createApp } from "./app.js";
import { BullMqDeliveryQueue } from "./deliveryQueue.js";
import { parseHeaderList } from "./ingest/headers.js";
import { MetricsCollector } from "./observability/metrics.js";

const env = bootEnv();
const { db, pool } = createDb(env.DATABASE_URL);
const metrics = new MetricsCollector();
const deliveryQueue = new BullMqDeliveryQueue(env.REDIS_URL, env.DELIVERY_MAX_ATTEMPTS);
const app = createApp({
  db,
  deliveryQueue,
  operatorApiKey: env.OPERATOR_API_KEY,
  cookieName: env.COOKIE_NAME,
  ingestMaxBodyBytes: env.INGEST_MAX_BODY_BYTES,
  ingestHeaderAllowlist: parseHeaderList(env.INGEST_HEADER_ALLOWLIST),
  ingestHeaderDenylist: parseHeaderList(env.INGEST_HEADER_DENYLIST),
  metrics,
  renderMetrics: () => metrics.render(deliveryQueue.bullQueue),
});
const server = createServer(app.callback());

server.listen(env.PORT, () => {
  console.log(JSON.stringify({ msg: "api listening", port: env.PORT }));
});

function shutdown(signal: string): void {
  console.log(JSON.stringify({ msg: "api shutting down", signal }));
  server.close(() => {
    void Promise.all([pool.end(), deliveryQueue.close()]).finally(() => process.exit(0));
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
