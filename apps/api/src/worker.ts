import { Worker, type Job } from "bullmq";
import { createDb } from "@webhook-broadcast/db";
import { bootEnv } from "./config.js";
import { DELIVERY_QUEUE_NAME, type DeliveryJobData } from "./deliveryQueue.js";
import { createHealthServer } from "./healthServer.js";
import { RetryableDeliveryError } from "./worker/errors.js";
import { processDeliveryJob } from "./worker/processDeliveryJob.js";

const env = bootEnv();
const { db, pool } = createDb(env.DATABASE_URL);

const worker = new Worker<DeliveryJobData>(
  DELIVERY_QUEUE_NAME,
  async (job: Job<DeliveryJobData>) => {
    await processDeliveryJob(
      {
        db,
        defaultTimeoutMs: env.DELIVERY_TIMEOUT_MS,
        maxAttempts: env.DELIVERY_MAX_ATTEMPTS,
        backoffBaseMs: env.DELIVERY_BACKOFF_MS,
        backoffMaxMs: env.DELIVERY_BACKOFF_MAX_MS,
      },
      job.data.deliveryId,
    );
  },
  {
    connection: { url: env.REDIS_URL },
    concurrency: env.WORKER_CONCURRENCY,
    settings: {
      // ADR 0003's backoff math all lives in retryPolicy.ts/processDeliveryJob.ts;
      // this just relays the delay a RetryableDeliveryError already computed.
      backoffStrategy: (_attemptsMade, _type, err) =>
        err instanceof RetryableDeliveryError ? err.delayMs : -1,
    },
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
    pool.end(),
    new Promise<void>((resolve) => healthServer.close(() => resolve())),
  ]).then(() => process.exit(0));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
