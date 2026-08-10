import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { randomUUID } from "node:crypto";
import { Worker } from "bullmq";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  BullMqDeliveryQueue,
  DELIVERY_QUEUE_NAME,
  type DeliveryJobData,
} from "../src/deliveryQueue.js";

function sampleJob(deliveryId = randomUUID()): DeliveryJobData {
  return {
    deliveryId,
    requestId: randomUUID(),
    channelId: randomUUID(),
    broadcastId: randomUUID(),
    endpointId: randomUUID(),
  };
}

async function waitForJobState(
  queue: BullMqDeliveryQueue,
  deliveryId: string,
  state: "completed" | "failed" | "waiting",
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = await queue.bullQueue.getJob(deliveryId);
    if (job && (await job.getState()) === state) {
      return;
    }
    if (Date.now() > deadline) {
      const current = job ? await job.getState() : "missing";
      throw new Error(
        `timed out waiting for job ${deliveryId} to reach ${state} (last: ${current})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("BullMqDeliveryQueue", () => {
  let redis: StartedRedisContainer;
  let queue: BullMqDeliveryQueue;
  let worker: Worker<DeliveryJobData> | undefined;

  beforeAll(async () => {
    redis = await new RedisContainer("redis:7-alpine").start();
    queue = new BullMqDeliveryQueue(redis.getConnectionUrl(), 1);
  }, 120_000);

  afterEach(async () => {
    await worker?.close();
    worker = undefined;
    await queue.bullQueue.obliterate({ force: true });
  });

  afterAll(async () => {
    await queue.close();
    await redis.stop();
  }, 30_000);

  it("re-enqueues a Delivery after the prior BullMQ job completed", async () => {
    worker = new Worker<DeliveryJobData>(DELIVERY_QUEUE_NAME, async () => undefined, {
      connection: { url: redis.getConnectionUrl() },
    });
    await worker.waitUntilReady();

    const job = sampleJob();
    await queue.enqueue(job);
    await waitForJobState(queue, job.deliveryId, "completed");

    // Stop the worker so the re-enqueued job stays in `waiting` for us to observe.
    await worker.close();
    worker = undefined;

    await queue.enqueue(job);

    const requeued = await queue.bullQueue.getJob(job.deliveryId);
    expect(requeued).toBeDefined();
    expect(await requeued!.getState()).toBe("waiting");
  });

  it("re-enqueues a Delivery after the prior BullMQ job failed", async () => {
    worker = new Worker<DeliveryJobData>(
      DELIVERY_QUEUE_NAME,
      async () => {
        throw new Error("always fails");
      },
      {
        connection: { url: redis.getConnectionUrl() },
        settings: { backoffStrategy: () => 1 },
      },
    );
    await worker.waitUntilReady();

    const job = sampleJob();
    await queue.enqueue(job);
    await waitForJobState(queue, job.deliveryId, "failed");

    await worker.close();
    worker = undefined;

    await queue.enqueue(job);

    const requeued = await queue.bullQueue.getJob(job.deliveryId);
    expect(requeued).toBeDefined();
    expect(await requeued!.getState()).toBe("waiting");
  });

  it("enqueueBulk adds every Delivery job", async () => {
    const jobs = [sampleJob(), sampleJob(), sampleJob()];
    await queue.enqueueBulk(jobs);

    for (const job of jobs) {
      const queued = await queue.bullQueue.getJob(job.deliveryId);
      expect(queued).toBeDefined();
      expect(await queued!.getState()).toBe("waiting");
    }
  });
});
