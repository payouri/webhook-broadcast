import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import type { Channel, ChannelList, Endpoint } from "@webhook-broadcast/contract";
import {
  CHANNEL_RECENT_FAILURE_WINDOW_MS,
  completeDelivery,
  createDeliveriesForBroadcast,
  insertBroadcast,
} from "@webhook-broadcast/db";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { FakeDeliveryQueue } from "./fakeDeliveryQueue.js";
import { startTestDb, type TestDb } from "./testDb.js";

const OPERATOR_API_KEY = "test-operator-key";
const COOKIE_NAME = "wb_operator";

/**
 * Issue #44: the Channel directory's recent-failure signal, at the HTTP seam
 * so it exercises the real grouped-query aggregate rather than a mocked
 * repository. Covers the three AC-named shapes: a Channel with
 * dead-lettered Deliveries, one with only successes, and one with no
 * Broadcasts at all.
 */
describe("Channel directory — recent-failure signal (GET /channels)", () => {
  let testDb: TestDb;
  let server: Server;
  let baseUrl: string;

  function authed(init: RequestInit = {}): RequestInit {
    return { ...init, headers: { authorization: `Bearer ${OPERATOR_API_KEY}`, ...init.headers } };
  }

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

  async function createChannel(slug: string): Promise<Channel> {
    const response = await fetch(
      `${baseUrl}/channels`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug }),
      }),
    );
    return (await response.json()) as Channel;
  }

  async function createEndpoint(channelId: string, url: string): Promise<Endpoint> {
    const response = await fetch(
      `${baseUrl}/channels/${channelId}/endpoints`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      }),
    );
    return (await response.json()) as Endpoint;
  }

  async function deliverOne(
    channelId: string,
    endpointId: string,
    status: "succeeded" | "failed" | "dead_lettered",
    now: Date,
  ): Promise<void> {
    const broadcast = await insertBroadcast(testDb.db, {
      id: randomUUID(),
      channelId,
      receivedAt: now,
      contentType: "application/json",
      body: Buffer.from("{}"),
      headers: {},
    });
    const [delivery] = await createDeliveriesForBroadcast(testDb.db, {
      broadcastId: broadcast.id,
      channelId,
      endpointIds: [endpointId],
      now,
    });
    if (!delivery) {
      throw new Error("expected Delivery");
    }
    await completeDelivery(testDb.db, {
      deliveryId: delivery.id,
      n: 1,
      statusCode: status === "succeeded" ? 200 : 503,
      durationMs: 100,
      error: status === "succeeded" ? null : "boom",
      status,
      at: now,
    });
  }

  function channelBySlug(list: ChannelList, slug: string): Channel {
    const channel = list.items.find((item) => item.slug === slug);
    if (!channel) {
      throw new Error(`expected a Channel with slug "${slug}"`);
    }
    return channel;
  }

  it("counts dead-lettered and failed Deliveries per Channel and distinguishes zero failures from no activity", async () => {
    const now = new Date();

    const failing = await createChannel("failing");
    const failingEndpoint = await createEndpoint(failing.id, "https://example.com/failing");
    await deliverOne(failing.id, failingEndpoint.id, "dead_lettered", now);
    await deliverOne(failing.id, failingEndpoint.id, "failed", now);
    await deliverOne(failing.id, failingEndpoint.id, "succeeded", now);

    const healthy = await createChannel("healthy");
    const healthyEndpoint = await createEndpoint(healthy.id, "https://example.com/healthy");
    await deliverOne(healthy.id, healthyEndpoint.id, "succeeded", now);
    await deliverOne(healthy.id, healthyEndpoint.id, "succeeded", now);

    // No Broadcasts at all — must read as "no activity", never "healthy".
    await createChannel("quiet");

    const listResponse = await fetch(`${baseUrl}/channels`, authed());
    expect(listResponse.status).toBe(200);
    const list = (await listResponse.json()) as ChannelList;

    expect(channelBySlug(list, "failing")).toMatchObject({
      hasBroadcasts: true,
      recentFailedDeliveryCount: 2,
    });
    expect(channelBySlug(list, "healthy")).toMatchObject({
      hasBroadcasts: true,
      recentFailedDeliveryCount: 0,
    });
    expect(channelBySlug(list, "quiet")).toMatchObject({
      hasBroadcasts: false,
      recentFailedDeliveryCount: 0,
    });
  });

  /**
   * The window constant is the point of AC #2 — without this the aggregate
   * would pass every other assertion while counting failures from any time.
   */
  it("counts only failures inside CHANNEL_RECENT_FAILURE_WINDOW_MS, not the Channel's whole history", async () => {
    const now = new Date();
    const stale = new Date(now.getTime() - CHANNEL_RECENT_FAILURE_WINDOW_MS - 60_000);
    const justInside = new Date(now.getTime() - CHANNEL_RECENT_FAILURE_WINDOW_MS + 60_000);

    const old = await createChannel("old-failures");
    const oldEndpoint = await createEndpoint(old.id, "https://example.com/old");
    await deliverOne(old.id, oldEndpoint.id, "dead_lettered", stale);
    await deliverOne(old.id, oldEndpoint.id, "failed", stale);

    const edge = await createChannel("edge-failures");
    const edgeEndpoint = await createEndpoint(edge.id, "https://example.com/edge");
    await deliverOne(edge.id, edgeEndpoint.id, "dead_lettered", justInside);
    await deliverOne(edge.id, edgeEndpoint.id, "dead_lettered", stale);

    const list = (await (await fetch(`${baseUrl}/channels`, authed())).json()) as ChannelList;

    // Broadcasts still exist, so this is "healthy", never "no activity".
    expect(channelBySlug(list, "old-failures")).toMatchObject({
      hasBroadcasts: true,
      recentFailedDeliveryCount: 0,
    });
    expect(channelBySlug(list, "edge-failures")).toMatchObject({
      hasBroadcasts: true,
      recentFailedDeliveryCount: 1,
    });
  });

  /**
   * AC: "The aggregate is computed in one query per list request, not one query
   * per Channel." Asserted behaviourally — the statement count for the list
   * request must not grow with the number of Channels on the page.
   */
  it("does not issue more queries as the page grows — no per-Channel fan-out", async () => {
    const now = new Date();

    // Counted at the pg Pool, the one seam every repository call funnels through.
    const pool = testDb.pool as unknown as { query: (...args: unknown[]) => unknown };

    async function countQueriesForList(): Promise<number> {
      const original = pool.query.bind(pool);
      let queries = 0;
      pool.query = (...args: unknown[]) => {
        queries += 1;
        return original(...args);
      };
      try {
        const response = await fetch(`${baseUrl}/channels`, authed());
        expect(response.status).toBe(200);
        await response.json();
      } finally {
        pool.query = original;
      }
      return queries;
    }

    const first = await createChannel("page-1");
    const firstEndpoint = await createEndpoint(first.id, "https://example.com/page-1");
    await deliverOne(first.id, firstEndpoint.id, "dead_lettered", now);
    const oneChannelQueries = await countQueriesForList();

    for (const slug of ["page-2", "page-3", "page-4", "page-5"]) {
      const channel = await createChannel(slug);
      const endpoint = await createEndpoint(channel.id, `https://example.com/${slug}`);
      await deliverOne(channel.id, endpoint.id, "failed", now);
    }
    const fiveChannelQueries = await countQueriesForList();

    expect(oneChannelQueries).toBeGreaterThan(0);
    expect(fiveChannelQueries).toBe(oneChannelQueries);
  });

  it("excludes a soft-deleted Channel from the list even when it has recent failures", async () => {
    const now = new Date();
    const channel = await createChannel("gone");
    const endpoint = await createEndpoint(channel.id, "https://example.com/gone");
    await deliverOne(channel.id, endpoint.id, "dead_lettered", now);

    const deleteResponse = await fetch(
      `${baseUrl}/channels/${channel.id}`,
      authed({ method: "DELETE" }),
    );
    expect(deleteResponse.status).toBe(204);

    const listResponse = await fetch(`${baseUrl}/channels`, authed());
    const list = (await listResponse.json()) as ChannelList;
    expect(list.items.find((item) => item.id === channel.id)).toBeUndefined();
  });
});
