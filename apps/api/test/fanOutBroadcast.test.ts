import { randomUUID } from "node:crypto";
import {
  getBroadcastById,
  insertChannel,
  insertEndpoint,
  type Database,
} from "@webhook-broadcast/db";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { DeliveryJobData, DeliveryQueue } from "../src/deliveryQueue.js";
import { fanOutBroadcast } from "../src/fanOutBroadcast.js";
import { FakeDeliveryQueue } from "./fakeDeliveryQueue.js";
import { startTestDb, type TestDb } from "./testDb.js";

class FailingDeliveryQueue implements DeliveryQueue {
  readonly enqueuedBeforeFailure: DeliveryJobData[] = [];

  constructor(private readonly failOnBulk: boolean) {}

  async enqueue(job: DeliveryJobData): Promise<void> {
    this.enqueuedBeforeFailure.push(job);
  }

  async enqueueBulk(jobs: DeliveryJobData[]): Promise<void> {
    if (this.failOnBulk) {
      throw new Error("enqueueBulk failed");
    }
    this.enqueuedBeforeFailure.push(...jobs);
  }
}

class ObservingDeliveryQueue extends FakeDeliveryQueue {
  readonly broadcastIdsAtEnqueue: string[] = [];

  constructor(
    private readonly db: Database,
    private readonly channelId: string,
  ) {
    super();
  }

  override async enqueueBulk(jobs: DeliveryJobData[]): Promise<void> {
    for (const job of jobs) {
      const broadcast = await getBroadcastById(this.db, this.channelId, job.broadcastId);
      if (!broadcast) {
        throw new Error("enqueue ran before Broadcast was persisted");
      }
      this.broadcastIdsAtEnqueue.push(job.broadcastId);
    }
    await super.enqueueBulk(jobs);
  }
}

describe("fanOutBroadcast", () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await startTestDb();
  }, 60_000);

  afterEach(async () => {
    await testDb.reset();
  });

  afterAll(async () => {
    await testDb.stop();
  }, 30_000);

  async function seedChannelWithEndpoints(endpointCount: number) {
    const now = new Date();
    const channel = await insertChannel(testDb.db, {
      id: randomUUID(),
      slug: `ch-${randomUUID()}`,
      description: null,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    const endpoints = await Promise.all(
      Array.from({ length: endpointCount }, (_, index) =>
        insertEndpoint(testDb.db, {
          id: randomUUID(),
          channelId: channel.id,
          name: null,
          url: `https://example.com/${index}`,
          timeoutMs: null,
          headers: {},
          enabled: true,
          createdAt: now,
          updatedAt: now,
        }),
      ),
    );
    return { channel, endpoints };
  }

  it("persists Broadcast and Deliveries before enqueueBulk runs", async () => {
    const { channel } = await seedChannelWithEndpoints(2);
    const deliveryQueue = new ObservingDeliveryQueue(testDb.db, channel.id);
    const broadcastId = randomUUID();
    const requestId = randomUUID();

    const result = await fanOutBroadcast({
      db: testDb.db,
      deliveryQueue,
      requestId,
      broadcast: {
        id: broadcastId,
        channelId: channel.id,
        receivedAt: new Date(),
        contentType: "text/plain",
        body: Buffer.from("hello"),
        headers: {},
      },
    });

    expect(result.deliveryCount).toBe(2);
    expect(deliveryQueue.enqueued).toHaveLength(2);
    expect(deliveryQueue.broadcastIdsAtEnqueue).toEqual([broadcastId, broadcastId]);
    expect(deliveryQueue.enqueued.every((job) => job.requestId === requestId)).toBe(true);
    expect(deliveryQueue.enqueued.every((job) => job.broadcastId === broadcastId)).toBe(true);
  });

  it("uses one shared requestId for every enqueued Delivery job", async () => {
    const { channel } = await seedChannelWithEndpoints(3);
    const deliveryQueue = new FakeDeliveryQueue();

    await fanOutBroadcast({
      db: testDb.db,
      deliveryQueue,
      broadcast: {
        id: randomUUID(),
        channelId: channel.id,
        receivedAt: new Date(),
        contentType: "text/plain",
        body: Buffer.from("payload"),
        headers: {},
      },
    });

    const requestIds = new Set(deliveryQueue.enqueued.map((job) => job.requestId));
    expect(requestIds.size).toBe(1);
  });

  it("rolls back the Broadcast when enqueueBulk fails so accept does not leave orphan rows", async () => {
    const { channel } = await seedChannelWithEndpoints(2);
    const deliveryQueue = new FailingDeliveryQueue(true);
    const broadcastId = randomUUID();

    await expect(
      fanOutBroadcast({
        db: testDb.db,
        deliveryQueue,
        broadcast: {
          id: broadcastId,
          channelId: channel.id,
          receivedAt: new Date(),
          contentType: "text/plain",
          body: Buffer.from("hello"),
          headers: {},
        },
      }),
    ).rejects.toThrow("enqueueBulk failed");

    expect(deliveryQueue.enqueuedBeforeFailure).toHaveLength(0);

    const broadcast = await getBroadcastById(testDb.db, channel.id, broadcastId);
    expect(broadcast).toBeUndefined();
  });
});
