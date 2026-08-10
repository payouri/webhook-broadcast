import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import type { Attempt, DeliveryDetail } from "@webhook-broadcast/contract";
import {
  completeDelivery,
  createDeliveriesForBroadcast,
  insertBroadcast,
  insertChannel,
  insertEndpoint,
} from "@webhook-broadcast/db";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { FakeDeliveryQueue } from "./fakeDeliveryQueue.js";
import { startTestDb, type TestDb } from "./testDb.js";

const OPERATOR_API_KEY = "test-operator-key";
const COOKIE_NAME = "wb_operator";

describe("Delivery detail + Retry Delivery — /deliveries/:id (admin HTTP seam)", () => {
  let testDb: TestDb;
  let deliveryQueue: FakeDeliveryQueue;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    testDb = await startTestDb();
    deliveryQueue = new FakeDeliveryQueue();
    const app = createApp({
      db: testDb.db,
      deliveryQueue,
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
    deliveryQueue.enqueued.length = 0;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await testDb.stop();
  }, 30_000);

  function authed(init: RequestInit = {}): RequestInit {
    return { ...init, headers: { authorization: `Bearer ${OPERATOR_API_KEY}`, ...init.headers } };
  }

  /** Seeds a Channel/Endpoint/Broadcast/Delivery quartet directly through the db package,
   * bypassing ingest + the worker so status/Attempt fixtures are exact and instant. */
  async function seedDelivery(options: {
    status: "pending" | "in_progress" | "succeeded" | "failed" | "dead_lettered";
    endpointName?: string | null;
    endpointUrl?: string;
    attempts?: { n: number; statusCode: number | null; durationMs: number; error: string | null }[];
  }): Promise<{ deliveryId: string; endpointId: string; channelId: string; broadcastId: string }> {
    const now = new Date();
    const channel = await insertChannel(testDb.db, {
      id: randomUUID(),
      slug: `channel-${randomUUID()}`,
      description: null,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    const endpoint = await insertEndpoint(testDb.db, {
      id: randomUUID(),
      channelId: channel.id,
      name: options.endpointName ?? "Orders webhook",
      url: options.endpointUrl ?? "https://example.com/hook",
      timeoutMs: null,
      headers: {},
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    const broadcast = await insertBroadcast(testDb.db, {
      id: randomUUID(),
      channelId: channel.id,
      receivedAt: now,
      contentType: "application/json",
      body: Buffer.from(JSON.stringify({ hello: "world" })),
      headers: {},
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

    for (const attempt of options.attempts ?? []) {
      await completeDelivery(testDb.db, {
        deliveryId: delivery.id,
        n: attempt.n,
        statusCode: attempt.statusCode,
        durationMs: attempt.durationMs,
        error: attempt.error,
        status: options.status,
        at: now,
      });
    }
    return {
      deliveryId: delivery.id,
      endpointId: endpoint.id,
      channelId: channel.id,
      broadcastId: broadcast.id,
    };
  }

  const UNKNOWN_ID = "00000000-0000-0000-0000-000000000000";

  describe("GET /deliveries/:deliveryId", () => {
    it("404s for an unknown Delivery", async () => {
      const response = await fetch(`${baseUrl}/deliveries/${UNKNOWN_ID}`, authed());
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "not_found" } });
    });

    it("400s on a malformed Delivery id", async () => {
      const response = await fetch(`${baseUrl}/deliveries/not-a-uuid`, authed());
      expect(response.status).toBe(400);
    });

    it("returns Endpoint identity and status for an existing Delivery", async () => {
      const seeded = await seedDelivery({
        status: "dead_lettered",
        endpointName: "Orders webhook",
        endpointUrl: "https://example.com/hook",
        attempts: [{ n: 1, statusCode: 503, durationMs: 42, error: null }],
      });

      const response = await fetch(`${baseUrl}/deliveries/${seeded.deliveryId}`, authed());
      expect(response.status).toBe(200);
      const body = (await response.json()) as DeliveryDetail;
      expect(body).toMatchObject({
        id: seeded.deliveryId,
        broadcastId: seeded.broadcastId,
        channelId: seeded.channelId,
        endpointId: seeded.endpointId,
        endpointName: "Orders webhook",
        endpointUrl: "https://example.com/hook",
        status: "dead_lettered",
        attemptCount: 1,
        lastStatusCode: 503,
      });
    });
  });

  describe("GET /deliveries/:deliveryId/attempts", () => {
    it("404s for an unknown Delivery", async () => {
      const response = await fetch(`${baseUrl}/deliveries/${UNKNOWN_ID}/attempts`, authed());
      expect(response.status).toBe(404);
    });

    it("returns the Attempt timeline oldest-first", async () => {
      const seeded = await seedDelivery({
        status: "dead_lettered",
        attempts: [
          { n: 1, statusCode: 503, durationMs: 10, error: null },
          { n: 2, statusCode: null, durationMs: 20, error: "timed out after 10000ms" },
        ],
      });

      const response = await fetch(`${baseUrl}/deliveries/${seeded.deliveryId}/attempts`, authed());
      expect(response.status).toBe(200);
      const body = (await response.json()) as { items: Attempt[] };
      expect(body.items).toHaveLength(2);
      expect(body.items[0]).toMatchObject({ n: 1, statusCode: 503, durationMs: 10, error: null });
      expect(body.items[1]).toMatchObject({
        n: 2,
        statusCode: null,
        error: "timed out after 10000ms",
      });
    });
  });

  describe("POST /deliveries/:deliveryId/retry", () => {
    it("404s for an unknown Delivery", async () => {
      const response = await fetch(
        `${baseUrl}/deliveries/${UNKNOWN_ID}/retry`,
        authed({ method: "POST" }),
      );
      expect(response.status).toBe(404);
    });

    it.each(["pending", "in_progress", "succeeded", "failed"] as const)(
      "409s for a %s Delivery instead of re-queueing it",
      async (status) => {
        const seeded = await seedDelivery({
          status,
          attempts: [
            { n: 1, statusCode: status === "succeeded" ? 200 : 500, durationMs: 5, error: null },
          ],
        });

        const response = await fetch(
          `${baseUrl}/deliveries/${seeded.deliveryId}/retry`,
          authed({ method: "POST" }),
        );
        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toMatchObject({ error: { code: "conflict" } });
        expect(deliveryQueue.enqueued).toEqual([]);
      },
    );

    it("re-queues a dead_lettered Delivery and returns it back to pending", async () => {
      const seeded = await seedDelivery({
        status: "dead_lettered",
        attempts: [{ n: 1, statusCode: 503, durationMs: 5, error: null }],
      });

      const response = await fetch(
        `${baseUrl}/deliveries/${seeded.deliveryId}/retry`,
        authed({ method: "POST" }),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as DeliveryDetail;
      expect(body).toMatchObject({ id: seeded.deliveryId, status: "pending" });
      expect(deliveryQueue.enqueued).toEqual([seeded.deliveryId]);

      // A second retry click, before the worker has picked it back up, is a no-op 409 —
      // exactly like clicking the retry action for a Delivery that's no longer dead-lettered.
      const secondResponse = await fetch(
        `${baseUrl}/deliveries/${seeded.deliveryId}/retry`,
        authed({ method: "POST" }),
      );
      expect(secondResponse.status).toBe(409);
    });
  });
});
