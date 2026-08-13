import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import {
  completeDelivery,
  createDeliveriesForBroadcast,
  getBroadcastById,
  insertBroadcast,
  insertChannel,
  insertEndpoint,
  schema,
} from "@webhook-broadcast/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { runRetentionSweep, startRetentionSweeper } from "../src/worker/retentionSweeper.js";
import { FakeDeliveryQueue } from "./fakeDeliveryQueue.js";
import { startTestDb, type TestDb } from "./testDb.js";

const OPERATOR_API_KEY = "test-operator-key";
const COOKIE_NAME = "wb_operator";

/**
 * Retention sweeper seam (issue #24 / ADR 0002): prune Broadcasts older than
 * HISTORY_RETENTION_DAYS against real Postgres (cascade via ADR 0007 FKs),
 * then prove admin get + Replay treat the pruned Broadcast as not found.
 */
describe("retention sweeper (prune seam)", () => {
  let testDb: TestDb;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    testDb = await startTestDb();
    const app = createApp({
      db: testDb.db,
      deliveryQueue: new FakeDeliveryQueue(),
      operatorApiKey: OPERATOR_API_KEY,
      cookieName: COOKIE_NAME,
    });
    server = createServer(app.callback());
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  }, 60_000);

  afterEach(async () => {
    await testDb.reset();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await testDb.stop();
  }, 30_000);

  function authed(init: RequestInit = {}): RequestInit {
    return { ...init, headers: { authorization: `Bearer ${OPERATOR_API_KEY}`, ...init.headers } };
  }

  async function seedBroadcast(input: {
    receivedAt: Date;
    withDeliveryAndAttempt?: boolean;
  }): Promise<{ channelId: string; broadcastId: string; deliveryId?: string }> {
    const now = new Date();
    const channel = await insertChannel(testDb.db, {
      id: randomUUID(),
      slug: `channel-${randomUUID()}`,
      description: null,
      enabled: true,
      allowUnauthenticatedIngest: false,
      createdAt: now,
      updatedAt: now,
    });
    const broadcast = await insertBroadcast(testDb.db, {
      id: randomUUID(),
      channelId: channel.id,
      receivedAt: input.receivedAt,
      contentType: "application/json",
      body: Buffer.from('{"seeded":true}'),
      headers: { "x-seed": "1" },
    });

    if (!input.withDeliveryAndAttempt) {
      return { channelId: channel.id, broadcastId: broadcast.id };
    }

    const endpoint = await insertEndpoint(testDb.db, {
      id: randomUUID(),
      channelId: channel.id,
      name: "sink",
      url: `https://example.test/${randomUUID()}`,
      timeoutMs: null,
      headers: {},
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    const [delivery] = await createDeliveriesForBroadcast(testDb.db, {
      broadcastId: broadcast.id,
      channelId: channel.id,
      endpointIds: [endpoint.id],
      now,
    });
    if (!delivery) {
      throw new Error("expected a Delivery row");
    }
    await completeDelivery(testDb.db, {
      deliveryId: delivery.id,
      n: 1,
      statusCode: 200,
      durationMs: 12,
      error: null,
      status: "succeeded",
      at: now,
    });
    return { channelId: channel.id, broadcastId: broadcast.id, deliveryId: delivery.id };
  }

  it("deletes Broadcasts older than the retention window and cascades Deliveries and Attempts", async () => {
    const now = new Date("2026-08-10T12:00:00.000Z");
    const retentionDays = 30;
    const old = await seedBroadcast({
      receivedAt: new Date("2026-07-01T00:00:00.000Z"),
      withDeliveryAndAttempt: true,
    });
    const fresh = await seedBroadcast({
      receivedAt: new Date("2026-08-09T00:00:00.000Z"),
    });

    const deleted = await runRetentionSweep({
      db: testDb.db,
      retentionDays,
      now,
    });

    expect(deleted).toBe(1);
    expect(await getBroadcastById(testDb.db, old.channelId, old.broadcastId)).toBeUndefined();
    expect(await getBroadcastById(testDb.db, fresh.channelId, fresh.broadcastId)).toBeDefined();

    const leftoverDeliveries = await testDb.db
      .select()
      .from(schema.deliveries)
      .where(eq(schema.deliveries.broadcastId, old.broadcastId));
    expect(leftoverDeliveries).toEqual([]);

    expect(old.deliveryId).toBeDefined();
    const leftoverAttempts = await testDb.db
      .select()
      .from(schema.attempts)
      .where(eq(schema.attempts.deliveryId, old.deliveryId as string));
    expect(leftoverAttempts).toEqual([]);
  });

  it("makes admin get and Replay treat a pruned Broadcast as not found", async () => {
    const now = new Date("2026-08-10T12:00:00.000Z");
    const { channelId, broadcastId } = await seedBroadcast({
      receivedAt: new Date("2026-07-01T00:00:00.000Z"),
      withDeliveryAndAttempt: true,
    });

    await runRetentionSweep({ db: testDb.db, retentionDays: 30, now });

    const detail = await fetch(
      `${baseUrl}/channels/${channelId}/broadcasts/${broadcastId}`,
      authed(),
    );
    expect(detail.status).toBe(404);
    await expect(detail.json()).resolves.toMatchObject({ error: { code: "not_found" } });

    const replay = await fetch(
      `${baseUrl}/channels/${channelId}/broadcasts/${broadcastId}/replay`,
      authed({ method: "POST" }),
    );
    expect(replay.status).toBe(404);
    await expect(replay.json()).resolves.toMatchObject({ error: { code: "not_found" } });
  });

  it("hosts the retention interval inside the worker (boot pass + stop)", async () => {
    const now = new Date("2026-08-10T12:00:00.000Z");
    const old = await seedBroadcast({
      receivedAt: new Date("2026-07-01T00:00:00.000Z"),
    });

    const sweeper = startRetentionSweeper({
      db: testDb.db,
      retentionDays: 30,
      intervalMs: 60_000,
      now: () => now,
    });

    await expect
      .poll(async () => getBroadcastById(testDb.db, old.channelId, old.broadcastId))
      .toBeUndefined();

    sweeper.stop();
  });
});
