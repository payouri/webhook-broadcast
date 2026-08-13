import { Queue } from "bullmq";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { DEFAULT_DELIVERY_MAX_ATTEMPTS } from "@webhook-broadcast/contract/env";

export const DELIVERY_QUEUE_NAME = "delivery";

export interface DeliveryWorkItem {
  deliveryId: string;
  requestId: string;
  channelId: string;
  broadcastId: string;
  endpointId: string;
}

export function newRequestId(): string {
  return randomUUID();
}

/**
 * Narrow seam the ingest route depends on instead of BullMQ's `Queue`
 * directly — keeps route/unit tests from needing a live Redis, while
 * `BullMqDeliveryQueue` below is what `server.ts` wires in production.
 */
export interface DeliveryQueue {
  enqueue(workItem: DeliveryWorkItem): Promise<void>;
  enqueueBulk(workItems: DeliveryWorkItem[]): Promise<void>;
  ping(): Promise<void>;
}

/** Mirrors `DELIVERY_MAX_ATTEMPTS`'s env default (ADR 0003). */
const DEFAULT_MAX_ATTEMPTS = DEFAULT_DELIVERY_MAX_ATTEMPTS;

export class BullMqDeliveryQueue implements DeliveryQueue {
  private readonly queue: Queue<DeliveryWorkItem>;
  private readonly redisUrl: string;

  constructor(
    redisUrl: string,
    private readonly maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
  ) {
    this.redisUrl = redisUrl;
    this.queue = new Queue<DeliveryWorkItem>(DELIVERY_QUEUE_NAME, {
      connection: { url: redisUrl },
    });
  }

  get bullQueue(): Queue<DeliveryWorkItem> {
    return this.queue;
  }

  private async removeFinishedJob(deliveryId: string): Promise<void> {
    const existing = await this.queue.getJob(deliveryId);
    if (!existing) {
      return;
    }
    const state = await existing.getState();
    if (state === "completed" || state === "failed") {
      await this.queue.remove(deliveryId);
    }
  }

  private jobAddOptions(deliveryId: string) {
    return {
      jobId: deliveryId,
      attempts: this.maxAttempts,
      backoff: { type: "custom" as const },
    };
  }

  async enqueue(workItem: DeliveryWorkItem): Promise<void> {
    // `jobId: deliveryId` dedupes concurrent jobs, but BullMQ silently no-ops
    // `add` when that id already exists in a terminal state — remove it first
    // so operator retry of a dead_lettered Delivery actually re-enqueues.
    await this.removeFinishedJob(workItem.deliveryId);
    await this.queue.add("deliver", workItem, this.jobAddOptions(workItem.deliveryId));
  }

  async enqueueBulk(workItems: DeliveryWorkItem[]): Promise<void> {
    if (workItems.length === 0) {
      return;
    }
    await Promise.all(workItems.map((workItem) => this.removeFinishedJob(workItem.deliveryId)));
    await this.queue.addBulk(
      workItems.map((workItem) => ({
        name: "deliver",
        data: workItem,
        opts: this.jobAddOptions(workItem.deliveryId),
      })),
    );
  }

  async ping(): Promise<void> {
    const redis = new Redis(this.redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
      lazyConnect: true,
    });
    try {
      await redis.connect();
      const result = await redis.ping();
      if (result !== "PONG") {
        throw new Error("redis ping failed");
      }
    } finally {
      redis.disconnect();
    }
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
