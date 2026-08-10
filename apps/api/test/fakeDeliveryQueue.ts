import type { DeliveryQueue } from "../src/deliveryQueue.js";

/** In-process stand-in for `BullMqDeliveryQueue` — HTTP-seam tests exercise
 * fan-out without needing a live Redis. */
export class FakeDeliveryQueue implements DeliveryQueue {
  readonly enqueued: string[] = [];

  async enqueue(deliveryId: string): Promise<void> {
    this.enqueued.push(deliveryId);
  }
}
