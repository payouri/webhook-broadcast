import type { DeliveryQueue, DeliveryWorkItem } from "../src/deliveryQueue.js";

/** In-process stand-in for `BullMqDeliveryQueue` — HTTP-seam tests exercise
 * fan-out without needing a live Redis. */
export class FakeDeliveryQueue implements DeliveryQueue {
  readonly enqueued: DeliveryWorkItem[] = [];

  async enqueue(workItem: DeliveryWorkItem): Promise<void> {
    this.enqueued.push(workItem);
  }

  async enqueueBulk(workItems: DeliveryWorkItem[]): Promise<void> {
    this.enqueued.push(...workItems);
  }

  async ping(): Promise<void> {
    // In-process fake — always reachable for route tests that do not exercise /ready.
  }
}
