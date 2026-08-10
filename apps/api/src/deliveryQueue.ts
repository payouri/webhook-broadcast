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

export class BullMqDeliveryQueue implements DeliveryQueue {
  private readonly queue: Queue<DeliveryJobData>;

  constructor(redisUrl: string) {
    this.queue = new Queue<DeliveryJobData>(DELIVERY_QUEUE_NAME, {
      connection: { url: redisUrl },
    });
  }

  async enqueue(deliveryId: string): Promise<void> {
    // `jobId: deliveryId` makes re-enqueueing the same Delivery a no-op
    // (BullMQ dedupes on job id) instead of risking a second concurrent job.
    await this.queue.add("deliver", { deliveryId }, { jobId: deliveryId });
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
