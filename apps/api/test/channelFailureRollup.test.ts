import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import type { Channel, ChannelFailureRollup, Endpoint } from "@webhook-broadcast/contract";
import {
  CHANNEL_RECENT_FAILURE_WINDOW_MS,
  completeDelivery,
  createDeliveriesForBroadcast,
  insertBroadcast,
  updateEndpoint,
} from "@webhook-broadcast/db";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { FakeDeliveryQueue } from "./fakeDeliveryQueue.js";
import { startTestDb, type TestDb } from "./testDb.js";

const OPERATOR_API_KEY = "test-operator-key";
const COOKIE_NAME = "wb_operator";

/**
 * Issue #84: the ranked failure roll-up behind Channel Activity's "group
 * failures by Endpoint" view — at the HTTP seam so it exercises the real
 * grouped/ranked query, not a mocked repository.
 */
describe("Channel failure roll-up — GET /channels/:channelId/failures", () => {
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

  async function createEndpoint(channelId: string, url: string, name?: string): Promise<Endpoint> {
    const response = await fetch(
      `${baseUrl}/channels/${channelId}/endpoints`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(name ? { url, name } : { url }),
      }),
    );
    return (await response.json()) as Endpoint;
  }

  async function autoDisable(channelId: string, endpointId: string, at: Date): Promise<void> {
    await updateEndpoint(testDb.db, channelId, endpointId, {
      enabled: false,
      autoDisabledAt: at,
      updatedAt: at,
    });
  }

  async function deliverOne(
    channelId: string,
    endpointId: string,
    status: "succeeded" | "failed" | "dead_lettered",
    now: Date,
  ): Promise<string> {
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
    return delivery.id;
  }

  async function fetchRollup(channelId: string): Promise<ChannelFailureRollup> {
    const response = await fetch(`${baseUrl}/channels/${channelId}/failures`, authed());
    expect(response.status).toBe(200);
    return (await response.json()) as ChannelFailureRollup;
  }

  it("404s for an unknown Channel", async () => {
    const response = await fetch(
      `${baseUrl}/channels/00000000-0000-0000-0000-000000000000/failures`,
      authed(),
    );
    expect(response.status).toBe(404);
  });

  it("returns an empty roll-up, not an error, for a Channel with no in-window failures", async () => {
    const channel = await createChannel("quiet");
    const rollup = await fetchRollup(channel.id);
    expect(rollup).toEqual({ items: [] });
  });

  it("groups by Endpoint with correct failed/dead-lettered counts and lastFailureAt, excluding a healthy Endpoint", async () => {
    const now = new Date();
    const channel = await createChannel("orders");
    const broken = await createEndpoint(channel.id, "https://example.com/broken", "Broken Hook");
    const healthy = await createEndpoint(channel.id, "https://example.com/healthy");

    // Distinct timestamps, newest last, so `lastFailureAt` is pinned to the
    // newest *failure* rather than passing on a single shared value — and the
    // later `succeeded` proves a success never moves it.
    const older = new Date(now.getTime() - 60_000);
    const newest = new Date(now.getTime() - 30_000);
    await deliverOne(channel.id, broken.id, "dead_lettered", older);
    await deliverOne(channel.id, broken.id, "failed", newest);
    await deliverOne(channel.id, broken.id, "succeeded", now);
    await deliverOne(channel.id, healthy.id, "succeeded", now);

    const rollup = await fetchRollup(channel.id);
    expect(rollup.items).toHaveLength(1);
    expect(rollup.items[0]).toMatchObject({
      endpointId: broken.id,
      endpointName: "Broken Hook",
      endpointUrl: "https://example.com/broken",
      failed: 1,
      deadLettered: 1,
      lastFailureAt: newest.toISOString(),
      autoDisabledAt: null,
    });
  });

  it("sums Deliveries across two Endpoints for the same Broadcast independently (not deduped)", async () => {
    const now = new Date();
    const channel = await createChannel("fanout");
    const first = await createEndpoint(channel.id, "https://example.com/first");
    const second = await createEndpoint(channel.id, "https://example.com/second");

    const broadcast = await insertBroadcast(testDb.db, {
      id: randomUUID(),
      channelId: channel.id,
      receivedAt: now,
      contentType: "application/json",
      body: Buffer.from("{}"),
      headers: {},
    });
    const created = await createDeliveriesForBroadcast(testDb.db, {
      broadcastId: broadcast.id,
      channelId: channel.id,
      endpointIds: [first.id, second.id],
      now,
    });
    for (const delivery of created) {
      await completeDelivery(testDb.db, {
        deliveryId: delivery.id,
        n: 1,
        statusCode: 503,
        durationMs: 100,
        error: "boom",
        status: "failed",
        at: now,
      });
    }

    const rollup = await fetchRollup(channel.id);
    expect(rollup.items).toHaveLength(2);
    expect(rollup.items.map((item) => item.failed)).toEqual([1, 1]);
  });

  it("only counts failures inside CHANNEL_RECENT_FAILURE_WINDOW_MS, matching the Channel directory badge", async () => {
    const now = new Date();
    const stale = new Date(now.getTime() - CHANNEL_RECENT_FAILURE_WINDOW_MS - 60_000);
    const justInside = new Date(now.getTime() - CHANNEL_RECENT_FAILURE_WINDOW_MS + 60_000);

    const channel = await createChannel("windowed");
    const endpoint = await createEndpoint(channel.id, "https://example.com/windowed");
    await deliverOne(channel.id, endpoint.id, "dead_lettered", stale);
    await deliverOne(channel.id, endpoint.id, "dead_lettered", justInside);

    const rollup = await fetchRollup(channel.id);
    expect(rollup.items).toHaveLength(1);
    expect(rollup.items[0]).toMatchObject({ deadLettered: 1 });

    // The badge count on GET /channels must equal failed + deadLettered here.
    const listResponse = await fetch(`${baseUrl}/channels?slug=windowed`, authed());
    const list = (await listResponse.json()) as { items: Channel[] };
    const badge = list.items[0];
    expect(badge).toBeDefined();
    const rollupSum = rollup.items.reduce((sum, item) => sum + item.failed + item.deadLettered, 0);
    expect(badge?.recentFailedDeliveryCount).toBe(rollupSum);
  });

  it("ranks an auto-disabled Endpoint above every non-auto-disabled Endpoint regardless of counts", async () => {
    const now = new Date();
    const channel = await createChannel("severity");

    const noisy = await createEndpoint(channel.id, "https://example.com/noisy");
    for (let i = 0; i < 10; i += 1) {
      await deliverOne(channel.id, noisy.id, "failed", now);
    }

    const quietButDisabled = await createEndpoint(channel.id, "https://example.com/disabled");
    await deliverOne(channel.id, quietButDisabled.id, "failed", now);
    await autoDisable(channel.id, quietButDisabled.id, now);

    const rollup = await fetchRollup(channel.id);
    expect(rollup.items.map((item) => item.endpointId)).toEqual([quietButDisabled.id, noisy.id]);
    expect(rollup.items[0]?.autoDisabledAt).not.toBeNull();
  });

  it("ranks by deadLettered desc, then failed desc, then lastFailureAt desc among non-auto-disabled Endpoints", async () => {
    const now = new Date();
    const earlier = new Date(now.getTime() - 60_000);
    const channel = await createChannel("ranked");

    const mostDeadLettered = await createEndpoint(channel.id, "https://example.com/dlq-heavy");
    await deliverOne(channel.id, mostDeadLettered.id, "dead_lettered", now);
    await deliverOne(channel.id, mostDeadLettered.id, "dead_lettered", now);

    const mostFailed = await createEndpoint(channel.id, "https://example.com/failed-heavy");
    await deliverOne(channel.id, mostFailed.id, "dead_lettered", now);
    await deliverOne(channel.id, mostFailed.id, "failed", now);
    await deliverOne(channel.id, mostFailed.id, "failed", now);

    // Same dead-lettered/failed as `mostFailed` but its last failure is older
    // — must rank after `mostFailed` on the lastFailureAt tie-break.
    const olderLastFailure = await createEndpoint(channel.id, "https://example.com/older");
    await deliverOne(channel.id, olderLastFailure.id, "dead_lettered", earlier);
    await deliverOne(channel.id, olderLastFailure.id, "failed", earlier);
    await deliverOne(channel.id, olderLastFailure.id, "failed", earlier);

    const rollup = await fetchRollup(channel.id);
    expect(rollup.items.map((item) => item.endpointId)).toEqual([
      mostDeadLettered.id,
      mostFailed.id,
      olderLastFailure.id,
    ]);
  });

  it("tie-breaks identically ranked Endpoints deterministically by name/url then id", async () => {
    const now = new Date();
    const channel = await createChannel("tie-break");

    const b = await createEndpoint(channel.id, "https://example.com/b", "Bravo");
    await deliverOne(channel.id, b.id, "failed", now);

    const a = await createEndpoint(channel.id, "https://example.com/a", "Alpha");
    await deliverOne(channel.id, a.id, "failed", now);

    const rollup = await fetchRollup(channel.id);
    expect(rollup.items.map((item) => item.endpointId)).toEqual([a.id, b.id]);
  });
});
