import type { DeliveryJobData, DeliveryQueue } from "../src/deliveryQueue.js";

/** In-process stand-in for `BullMqDeliveryQueue` — HTTP-seam tests exercise
 * fan-out without needing a live Redis. */
export class FakeDeliveryQueue implements DeliveryQueue {
  readonly enqueued: DeliveryJobData[] = [];

  async enqueue(job: DeliveryJobData): Promise<void> {
    this.enqueued.push(job);
  }
}
