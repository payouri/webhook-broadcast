import { Queue } from "bullmq";

export const DELIVERY_QUEUE_NAME = "delivery";

export interface DeliveryJobData {
  deliveryId: string;
}

/**
 * Narrow seam the ingest route depends on instead of BullMQ's `Queue`
 * directly — keeps route/unit tests from needing a live Redis, while
 * `BullMqDeliveryQueue` below is what `server.ts` wires in production.
 */
export interface DeliveryQueue {
  enqueue(deliveryId: string): Promise<void>;
}

/** Mirrors `DELIVERY_MAX_ATTEMPTS`'s env default (ADR 0003). */
const DEFAULT_MAX_ATTEMPTS = 8;

export class BullMqDeliveryQueue implements DeliveryQueue {
  private readonly queue: Queue<DeliveryJobData>;

  constructor(
    redisUrl: string,
    private readonly maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
  ) {
    this.queue = new Queue<DeliveryJobData>(DELIVERY_QUEUE_NAME, {
      connection: { url: redisUrl },
    });
  }

  async enqueue(deliveryId: string): Promise<void> {
    // `jobId: deliveryId` makes re-enqueueing the same Delivery a no-op
    // (BullMQ dedupes on job id) instead of risking a second concurrent job.
    // `backoff: { type: "custom" }` defers to worker.ts's `backoffStrategy`,
    // which reads the delay straight off a thrown `RetryableDeliveryError`
    // (ADR 0003's policy lives in processDeliveryJob.ts, not here).
    await this.queue.add(
      "deliver",
      { deliveryId },
      { jobId: deliveryId, attempts: this.maxAttempts, backoff: { type: "custom" } },
    );
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
