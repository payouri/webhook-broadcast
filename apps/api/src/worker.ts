import { Worker } from "bullmq";
import { bootEnv } from "./config.js";
import { createHealthServer } from "./healthServer.js";

const env = bootEnv();

// Delivery job processing lands in a later slice; this stub proves the
// worker process boots, connects to Redis, and drains cleanly on SIGTERM.
const worker = new Worker(
  "delivery",
  async () => {
    // no-op until delivery fan-out ships
  },
  {
    connection: { url: env.REDIS_URL },
    concurrency: env.WORKER_CONCURRENCY,
  },
);

worker.on("error", (error) => {
  console.error(JSON.stringify({ msg: "worker error", error: String(error) }));
});

const healthServer = createHealthServer();
healthServer.listen(env.WORKER_HEALTH_PORT, () => {
  console.log(JSON.stringify({ msg: "worker listening", healthPort: env.WORKER_HEALTH_PORT }));
});

function shutdown(signal: string): void {
  console.log(JSON.stringify({ msg: "worker shutting down", signal }));
  Promise.all([
    worker.close(),
    new Promise<void>((resolve) => healthServer.close(() => resolve())),
  ]).then(() => process.exit(0));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
