import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import type { Channel, ChannelList, Endpoint } from "@webhook-broadcast/contract";
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

/**
 * Issue #45: surfacing the auto-disabled Endpoint count, and ranking the
 * Channel directory by health so a Channel needing attention is never
 * scrolled past. At the HTTP seam so it exercises the real ordering query,
 * not a mocked repository.
 */
describe("Channel directory — auto-disabled Endpoints and health-first ordering (GET /channels)", () => {
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

  async function createChannel(slug: string, enabled = true): Promise<Channel> {
    const response = await fetch(
      `${baseUrl}/channels`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, enabled }),
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

  async function fetchChannelList(): Promise<ChannelList> {
    const response = await fetch(`${baseUrl}/channels`, authed());
    expect(response.status).toBe(200);
    return (await response.json()) as ChannelList;
  }

  function channelBySlug(list: ChannelList, slug: string): Channel {
    const channel = list.items.find((item) => item.slug === slug);
    if (!channel) {
      throw new Error(`expected a Channel with slug "${slug}"`);
    }
    return channel;
  }

  it("reports how many of a Channel's Endpoints are currently auto-disabled", async () => {
    const now = new Date();
    const channel = await createChannel("with-auto-disabled");
    await createEndpoint(channel.id, "https://example.com/ok");
    const autoDisabledOne = await createEndpoint(channel.id, "https://example.com/one");
    const autoDisabledTwo = await createEndpoint(channel.id, "https://example.com/two");
    await autoDisable(channel.id, autoDisabledOne.id, now);
    await autoDisable(channel.id, autoDisabledTwo.id, now);

    const list = await fetchChannelList();
    expect(channelBySlug(list, "with-auto-disabled")).toMatchObject({
      autoDisabledEndpointCount: 2,
    });
  });

  it("drops a re-enabled Endpoint out of the auto-disabled count immediately", async () => {
    const now = new Date();
    const channel = await createChannel("re-enabled");
    const endpoint = await createEndpoint(channel.id, "https://example.com/re-enabled");
    await autoDisable(channel.id, endpoint.id, now);

    const patchResponse = await fetch(
      `${baseUrl}/channels/${channel.id}/endpoints/${endpoint.id}`,
      authed({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      }),
    );
    expect(patchResponse.status).toBe(200);

    const list = await fetchChannelList();
    expect(channelBySlug(list, "re-enabled")).toMatchObject({ autoDisabledEndpointCount: 0 });
  });

  it("ranks a failing Channel and one with an auto-disabled Endpoint above a healthy Channel, and parks a disabled Channel last even though it still carries recent failures", async () => {
    const now = new Date();

    // Tier 0: needs attention — recent failed/dead-lettered Deliveries.
    // Issue #66: within tier 0, this comes first because it has 1 recent failure
    // (failure count is the primary sort within the unhealthy tier).
    const failing = await createChannel("failing");
    const failingEndpoint = await createEndpoint(failing.id, "https://example.com/failing");
    await deliverOne(failing.id, failingEndpoint.id, "dead_lettered", now);

    // Tier 0: needs attention — a currently auto-disabled Endpoint, zero
    // recent Delivery failures on its own.
    // Issue #66: within tier 0, this comes second because it has 0 recent failures
    // and 1 auto-disabled endpoint (the tie-break when failure count is equal).
    const autoDisabledChannel = await createChannel("auto-disabled-channel");
    const autoDisabledEndpoint = await createEndpoint(
      autoDisabledChannel.id,
      "https://example.com/auto-disabled",
    );
    await autoDisable(autoDisabledChannel.id, autoDisabledEndpoint.id, now);

    // Tier 1: healthy — has taken traffic, nothing recently failed.
    const healthy = await createChannel("healthy");
    const healthyEndpoint = await createEndpoint(healthy.id, "https://example.com/healthy");
    await deliverOne(healthy.id, healthyEndpoint.id, "succeeded", now);

    // Tier 1: quiet — enabled, no Broadcasts at all; not "attention", not "broken".
    await createChannel("quiet");

    // Tier 2: disabled — a deliberate choice, so it must rank last and never
    // alongside "failing" even though it still carries a recent
    // dead-lettered Delivery from before it was switched off.
    const disabled = await createChannel("disabled-with-failures", false);
    const disabledEndpoint = await createEndpoint(
      disabled.id,
      "https://example.com/disabled-with-failures",
    );
    await deliverOne(disabled.id, disabledEndpoint.id, "dead_lettered", now);

    const list = await fetchChannelList();
    const slugs = list.items.map((item) => item.slug);

    // Issue #66: failing comes before auto-disabled-channel because it has 1
    // recent failure while auto-disabled-channel has 0. Healthy and quiet are
    // tier 1 (no attention needed). Disabled is tier 2, always last.
    expect(slugs).toEqual([
      "failing",
      "auto-disabled-channel",
      "healthy",
      "quiet",
      "disabled-with-failures",
    ]);
  });

  it("keeps the health-first order across cursor pages, without dropping or repeating a Channel", async () => {
    // The cursor now includes `healthRank`, `recentFailureCount`, and
    // `autoDisabledEndpointCount` alongside `(slug, id)`. Walking the directory
    // one Channel at a time exercises these keys in both the keyset WHERE
    // clause and the ORDER BY; if the two ever disagreed, a Channel would vanish
    // or repeat at a page boundary.
    const now = new Date();

    // Tier 0: failing with 1 failure; ranks first among tier 0.
    const failing = await createChannel("zeta-failing");
    const failingEndpoint = await createEndpoint(failing.id, "https://example.com/zeta-failing");
    await deliverOne(failing.id, failingEndpoint.id, "dead_lettered", now);

    // Tier 0: auto-disabled with 0 failures; ranks second among tier 0
    // (tie-broken by auto-disabled count).
    const autoDisabledChannel = await createChannel("yankee-auto-disabled");
    const autoDisabledEndpoint = await createEndpoint(
      autoDisabledChannel.id,
      "https://example.com/yankee-auto-disabled",
    );
    await autoDisable(autoDisabledChannel.id, autoDisabledEndpoint.id, now);

    // Tier 1: quiet — enabled, no Broadcasts.
    await createChannel("mike-quiet");

    // Tier 2: disabled — last regardless of failures.
    const disabled = await createChannel("alpha-disabled", false);
    const disabledEndpoint = await createEndpoint(
      disabled.id,
      "https://example.com/alpha-disabled",
    );
    await deliverOne(disabled.id, disabledEndpoint.id, "failed", now);

    const expected = (await fetchChannelList()).items.map((item) => item.slug);
    expect(expected).toEqual([
      "zeta-failing",
      "yankee-auto-disabled",
      "mike-quiet",
      "alpha-disabled",
    ]);

    const paged: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < expected.length + 1; page += 1) {
      const query = cursor === null ? "?limit=1" : `?limit=1&cursor=${encodeURIComponent(cursor)}`;
      const response = await fetch(`${baseUrl}/channels${query}`, authed());
      expect(response.status).toBe(200);
      const body = (await response.json()) as ChannelList;
      paged.push(...body.items.map((item) => item.slug));
      cursor = body.nextCursor;
      if (cursor === null) {
        break;
      }
    }

    expect(cursor).toBeNull();
    expect(paged).toEqual(expected);
  });

  it("orders Channels with identical failure count deterministically by slug then id", async () => {
    const now = new Date();
    const b = await createChannel("tie-b");
    const bEndpoint = await createEndpoint(b.id, "https://example.com/tie-b");
    await deliverOne(b.id, bEndpoint.id, "failed", now);

    const a = await createChannel("tie-a");
    const aEndpoint = await createEndpoint(a.id, "https://example.com/tie-a");
    await deliverOne(a.id, aEndpoint.id, "failed", now);

    const first = await fetchChannelList();
    const second = await fetchChannelList();

    const firstSlugs = first.items.map((item) => item.slug);
    const secondSlugs = second.items.map((item) => item.slug);
    expect(firstSlugs).toEqual(["tie-a", "tie-b"]);
    expect(secondSlugs).toEqual(firstSlugs);
  });

  /**
   * Issue #66: unhealthy Channels rank by severity — failure count is the
   * primary sort within the "needs attention" tier, so the worst Channel
   * (highest failure count) lands at the top where an operator's glance reads
   * it first. The tie-break is auto-disabled Endpoint count, then slug and id.
   */
  it("ranks failing Channels by recent failure count within the unhealthy tier", async () => {
    const now = new Date();

    // Tier 0: three failing Channels with different failure counts.
    // Issue #66 AC: higher failure count sorts ahead.
    const sevenFailures = await createChannel("seven-failures");
    const sevenEndpoint = await createEndpoint(sevenFailures.id, "https://example.com/seven");
    for (let i = 0; i < 7; i += 1) {
      await deliverOne(sevenFailures.id, sevenEndpoint.id, "failed", now);
    }

    const nineteenFailures = await createChannel("nineteen-failures");
    const nineteenEndpoint = await createEndpoint(
      nineteenFailures.id,
      "https://example.com/nineteen",
    );
    for (let i = 0; i < 19; i += 1) {
      await deliverOne(nineteenFailures.id, nineteenEndpoint.id, "failed", now);
    }

    const oneFailure = await createChannel("one-failure");
    const oneEndpoint = await createEndpoint(oneFailure.id, "https://example.com/one");
    await deliverOne(oneFailure.id, oneEndpoint.id, "dead_lettered", now);

    // Tier 1: a healthy Channel (should come after all the failing ones).
    const healthy = await createChannel("healthy");
    const healthyEndpoint = await createEndpoint(healthy.id, "https://example.com/healthy");
    await deliverOne(healthy.id, healthyEndpoint.id, "succeeded", now);

    const list = await fetchChannelList();
    const slugs = list.items.map((item) => item.slug);

    // The most broken (19 failures) comes first, then 7, then 1.
    // Healthy comes last.
    expect(slugs).toEqual(["nineteen-failures", "seven-failures", "one-failure", "healthy"]);
  });

  it("tie-breaks unhealthy Channels with equal failure count by auto-disabled Endpoint count", async () => {
    const now = new Date();

    // Both have 1 recent failure, but one has an auto-disabled Endpoint.
    // Issue #66 AC: the tie-break is deliberate — auto-disabled count is secondary.
    const failureWithAutoDisabled = await createChannel("failure-with-auto-disabled");
    const failureEndpoint1 = await createEndpoint(
      failureWithAutoDisabled.id,
      "https://example.com/fail1",
    );
    const failureEndpoint2 = await createEndpoint(
      failureWithAutoDisabled.id,
      "https://example.com/fail2",
    );
    await deliverOne(failureWithAutoDisabled.id, failureEndpoint1.id, "failed", now);
    await autoDisable(failureWithAutoDisabled.id, failureEndpoint2.id, now);

    const failureOnly = await createChannel("failure-only");
    const failureOnlyEndpoint = await createEndpoint(
      failureOnly.id,
      "https://example.com/failonly",
    );
    await deliverOne(failureOnly.id, failureOnlyEndpoint.id, "failed", now);

    const list = await fetchChannelList();
    const slugs = list.items.map((item) => item.slug);

    // Both have 1 failure; failure-with-auto-disabled has 1 auto-disabled,
    // failure-only has 0. So failure-with-auto-disabled comes first.
    expect(slugs).toEqual(["failure-with-auto-disabled", "failure-only"]);
  });

  it("maintains severity ordering across cursor pages without duplication or skipping", async () => {
    const now = new Date();

    const nineteen = await createChannel("nineteen");
    const nineteenEndpoint = await createEndpoint(nineteen.id, "https://example.com/nineteen");
    for (let i = 0; i < 19; i += 1) {
      await deliverOne(nineteen.id, nineteenEndpoint.id, "failed", now);
    }

    const seven = await createChannel("seven");
    const sevenEndpoint = await createEndpoint(seven.id, "https://example.com/seven");
    for (let i = 0; i < 7; i += 1) {
      await deliverOne(seven.id, sevenEndpoint.id, "failed", now);
    }

    const oneFailure = await createChannel("one");
    const oneEndpoint = await createEndpoint(oneFailure.id, "https://example.com/one");
    await deliverOne(oneFailure.id, oneEndpoint.id, "failed", now);

    const healthy = await createChannel("healthy");
    const healthyEndpoint = await createEndpoint(healthy.id, "https://example.com/healthy");
    await deliverOne(healthy.id, healthyEndpoint.id, "succeeded", now);

    // Walk the list one Channel at a time; keyset pagination exercises the
    // cursor comparison in the WHERE clause, which must match the ORDER BY,
    // or a Channel would vanish or repeat at a page boundary.
    const expected = ["nineteen", "seven", "one", "healthy"];
    const paged: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < expected.length + 1; page += 1) {
      const query = cursor === null ? "?limit=1" : `?limit=1&cursor=${encodeURIComponent(cursor)}`;
      const response = await fetch(`${baseUrl}/channels${query}`, authed());
      expect(response.status).toBe(200);
      const body = (await response.json()) as ChannelList;
      paged.push(...body.items.map((item) => item.slug));
      cursor = body.nextCursor;
      if (cursor === null) {
        break;
      }
    }

    expect(cursor).toBeNull();
    expect(paged).toEqual(expected);
  });

  /**
   * Issue #66 widened the cursor tuple, so a cursor minted by the previous
   * deploy — still live in an open tab or a client's retry — arrives carrying
   * only `(healthRank, slug, id)`. Accepting it pushes `undefined` into the
   * keyset `WHERE` as a bound parameter and the request 500s — this test fails
   * with exactly that status if the decode guard is ever loosened. Rejecting it
   * gives the client the 400 the contract already defines for an unreadable
   * cursor, so a directory paged across a deploy degrades honestly.
   */
  it("rejects a cursor minted before the severity legs existed rather than failing the request", async () => {
    const now = new Date();

    const failing = await createChannel("stale-cursor-failing");
    const failingEndpoint = await createEndpoint(
      failing.id,
      "https://example.com/stale-cursor-failing",
    );
    await deliverOne(failing.id, failingEndpoint.id, "failed", now);
    await createChannel("stale-cursor-healthy");

    const legacyCursor = Buffer.from(
      JSON.stringify({ healthRank: 0, slug: "stale-cursor-failing", id: failing.id }),
      "utf8",
    ).toString("base64url");

    const response = await fetch(
      `${baseUrl}/channels?limit=1&cursor=${encodeURIComponent(legacyCursor)}`,
      authed(),
    );

    expect(response.status).toBe(400);
  });
});
