import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import type {
  BroadcastDetail,
  BroadcastList,
  Channel,
  ChannelTokenCreated,
  Endpoint,
} from "@webhook-broadcast/contract";
import {
  completeDelivery,
  createDeliveriesForBroadcast,
  insertBroadcast,
} from "@webhook-broadcast/db";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { FakeDeliveryQueue } from "./fakeDeliveryQueue.js";
import { sha256Prefix } from "./sha256Prefix.js";
import { startTestDb, type TestDb } from "./testDb.js";

const OPERATOR_API_KEY = "test-operator-key";
const COOKIE_NAME = "wb_operator";

describe("Channel Activity — GET /channels/:channelId/broadcasts (admin HTTP seam)", () => {
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

  async function ingest(channelId: string, slug: string, body: string): Promise<string> {
    const mintResponse = await fetch(
      `${baseUrl}/channels/${channelId}/tokens`,
      authed({ method: "POST" }),
    );
    const { token } = (await mintResponse.json()) as ChannelTokenCreated;
    const response = await fetch(`${baseUrl}/ingest/${slug}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body,
    });
    const accepted = (await response.json()) as { id: string };
    return accepted.id;
  }

  it("404s for an unknown Channel", async () => {
    const response = await fetch(
      `${baseUrl}/channels/00000000-0000-0000-0000-000000000000/broadcasts`,
      authed(),
    );
    expect(response.status).toBe(404);
  });

  it("returns an empty list with a null cursor when there are no Broadcasts yet", async () => {
    const channel = await createChannel("orders");
    const response = await fetch(`${baseUrl}/channels/${channel.id}/broadcasts`, authed());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ items: [], nextCursor: null });
  });

  it("lists Broadcasts newest-first with receivedAt, bodyPreview, and a zeroed fanout summary", async () => {
    const channel = await createChannel("orders");
    const firstId = await ingest(channel.id, "orders", "first-payload");
    const secondId = await ingest(channel.id, "orders", "second-payload");

    const response = await fetch(`${baseUrl}/channels/${channel.id}/broadcasts`, authed());
    expect(response.status).toBe(200);
    const body = (await response.json()) as BroadcastList;

    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({
      id: secondId,
      channelId: channel.id,
      bodyPreview: "second-payload",
      fanout: { total: 0, succeeded: 0, failed: 0, deadLettered: 0, pending: 0 },
    });
    expect(body.items[1]).toMatchObject({ id: firstId, bodyPreview: "first-payload" });
    // `receivedAt` is what "newest-first" is ordered by, so assert it is an
    // ISO-8601 instant on both rows and that the order actually follows it.
    const receivedAt = body.items.map((item) => item.receivedAt);
    for (const value of receivedAt) {
      expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(Number.isNaN(Date.parse(value))).toBe(false);
    }
    expect(Date.parse(receivedAt[0] ?? "")).toBeGreaterThanOrEqual(Date.parse(receivedAt[1] ?? ""));
    expect(body.nextCursor).toBeNull();
  });

  it("paginates with an opaque cursor honoring the requested page size", async () => {
    const channel = await createChannel("orders");
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      ids.push(await ingest(channel.id, "orders", `payload-${i}`));
    }

    const firstPage = await fetch(`${baseUrl}/channels/${channel.id}/broadcasts?limit=2`, authed());
    const firstBody = (await firstPage.json()) as BroadcastList;
    expect(firstBody.items).toHaveLength(2);
    expect(firstBody.items.map((item) => item.id)).toEqual([ids[2], ids[1]]);
    expect(firstBody.nextCursor).toEqual(expect.any(String));

    const secondPage = await fetch(
      `${baseUrl}/channels/${channel.id}/broadcasts?limit=2&cursor=${encodeURIComponent(firstBody.nextCursor ?? "")}`,
      authed(),
    );
    const secondBody = (await secondPage.json()) as BroadcastList;
    expect(secondBody.items).toHaveLength(1);
    expect(secondBody.items[0]?.id).toEqual(ids[0]);
    expect(secondBody.nextCursor).toBeNull();
  });

  it("400s on a malformed cursor", async () => {
    const channel = await createChannel("orders");
    const response = await fetch(
      `${baseUrl}/channels/${channel.id}/broadcasts?cursor=not-base64url-json`,
      authed(),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "validation_failed" } });
  });
});

describe("Broadcast detail — GET /channels/:channelId/broadcasts/:broadcastId (admin HTTP seam)", () => {
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

  async function createChannel(slug: string, forwardHeaders?: string[]): Promise<Channel> {
    const response = await fetch(
      `${baseUrl}/channels`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(forwardHeaders ? { slug, forwardHeaders } : { slug }),
      }),
    );
    return (await response.json()) as Channel;
  }

  async function ingest(
    channelId: string,
    slug: string,
    body: string,
    extraHeaders: Record<string, string> = {},
  ): Promise<string> {
    const mintResponse = await fetch(
      `${baseUrl}/channels/${channelId}/tokens`,
      authed({ method: "POST" }),
    );
    const { token } = (await mintResponse.json()) as ChannelTokenCreated;
    const response = await fetch(`${baseUrl}/ingest/${slug}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...extraHeaders,
      },
      body,
    });
    const accepted = (await response.json()) as { id: string };
    return accepted.id;
  }

  async function getDetail(channelId: string, broadcastId: string): Promise<BroadcastDetail> {
    const response = await fetch(
      `${baseUrl}/channels/${channelId}/broadcasts/${broadcastId}`,
      authed(),
    );
    expect(response.status).toBe(200);
    return (await response.json()) as BroadcastDetail;
  }

  it("404s for an unknown Channel", async () => {
    const response = await fetch(
      `${baseUrl}/channels/00000000-0000-0000-0000-000000000000/broadcasts/00000000-0000-0000-0000-000000000000`,
      authed(),
    );
    expect(response.status).toBe(404);
  });

  it("404s for an unknown Broadcast on a known Channel", async () => {
    const channel = await createChannel("orders");
    const response = await fetch(
      `${baseUrl}/channels/${channel.id}/broadcasts/00000000-0000-0000-0000-000000000000`,
      authed(),
    );
    expect(response.status).toBe(404);
  });

  it("returns the full payload with an empty Delivery list when no Endpoints were enabled", async () => {
    const channel = await createChannel("orders");
    const broadcastId = await ingest(channel.id, "orders", JSON.stringify({ hello: "world" }));

    const response = await fetch(
      `${baseUrl}/channels/${channel.id}/broadcasts/${broadcastId}`,
      authed(),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      id: string;
      channelId: string;
      contentType: string;
      body: string;
      deliveries: unknown[];
    };
    expect(body).toMatchObject({
      id: broadcastId,
      channelId: channel.id,
      contentType: "application/json",
      body: JSON.stringify({ hello: "world" }),
      deliveries: [],
    });
  });

  /**
   * Issue #112: a stale producer-side shared secret is only ever visible as a
   * 401 on the Delivery, which says *that* the Endpoint rejected it, never
   * *what was presented*. These pin the one comparison that tells a stale
   * secret apart from a misconfigured Endpoint — and pin that making it
   * possible never puts the credential itself on the admin API.
   */
  it("omits forwardedHeaders entirely for a Channel that declares no forwardHeaders", async () => {
    const channel = await createChannel("orders");
    const broadcastId = await ingest(channel.id, "orders", "{}", {
      "x-unipile-webhook-secret": "derived-from-api-key",
    });

    const body = (await getDetail(channel.id, broadcastId)) as BroadcastDetail;
    expect(body).not.toHaveProperty("forwardedHeaders");
    expect(JSON.stringify(body)).not.toContain("derived-from-api-key");
  });

  it("fingerprints each stored forwarded header without disclosing its value", async () => {
    const channel = await createChannel("orders", ["x-unipile-webhook-secret"]);
    const broadcastId = await ingest(channel.id, "orders", "{}", {
      "x-unipile-webhook-secret": "derived-from-api-key",
      "x-not-declared": "ignored",
    });

    const body = (await getDetail(channel.id, broadcastId)) as BroadcastDetail;
    expect(body.forwardedHeaders).toEqual([
      {
        name: "x-unipile-webhook-secret",
        fingerprint: sha256Prefix("derived-from-api-key"),
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("derived-from-api-key");

    // AC: raw forwarded-header values are never returned by *any* admin
    // endpoint, so the sibling list route has to stay clean too — it is the
    // other route that reads the same Broadcast rows.
    const listResponse = await fetch(`${baseUrl}/channels/${channel.id}/broadcasts`, authed());
    expect(JSON.stringify(await listResponse.json())).not.toContain("derived-from-api-key");
  });

  it("fingerprints a replayed Broadcast the same as the original it copied", async () => {
    const channel = await createChannel("orders", ["x-unipile-webhook-secret"]);
    const originalId = await ingest(channel.id, "orders", "{}", {
      "x-unipile-webhook-secret": "derived-from-api-key",
    });

    const replayResponse = await fetch(
      `${baseUrl}/channels/${channel.id}/broadcasts/${originalId}/replay`,
      authed({ method: "POST" }),
    );
    expect(replayResponse.status).toBe(202);
    const { id: replayId } = (await replayResponse.json()) as { id: string };

    const original = await getDetail(channel.id, originalId);
    const replay = await getDetail(channel.id, replayId);
    expect(replay.forwardedHeaders).toEqual(original.forwardedHeaders);
    expect(JSON.stringify(replay)).not.toContain("derived-from-api-key");
  });

  it("gives two Broadcasts different fingerprints once the producer's secret rotates", async () => {
    const channel = await createChannel("orders", ["x-unipile-webhook-secret"]);
    const staleId = await ingest(channel.id, "orders", "{}", {
      "x-unipile-webhook-secret": "old-derived",
    });
    const rotatedId = await ingest(channel.id, "orders", "{}", {
      "x-unipile-webhook-secret": "new-derived",
    });

    const stale = (await getDetail(channel.id, staleId)) as BroadcastDetail;
    const rotated = (await getDetail(channel.id, rotatedId)) as BroadcastDetail;
    expect(stale.forwardedHeaders?.[0]?.fingerprint).not.toBe(
      rotated.forwardedHeaders?.[0]?.fingerprint,
    );
  });

  it("returns an empty list when the Channel declares a header the Broadcast never stored", async () => {
    const channel = await createChannel("orders", ["x-api-key"]);
    const broadcastId = await ingest(channel.id, "orders", "{}", {
      "x-api-key": "dropped-by-the-ingest-denylist",
    });

    const body = (await getDetail(channel.id, broadcastId)) as BroadcastDetail;
    expect(body.forwardedHeaders).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("dropped-by-the-ingest-denylist");
  });
});

describe("Broadcast replay — POST .../broadcasts/:broadcastId/replay (admin HTTP seam)", () => {
  let testDb: TestDb;
  let server: Server;
  let baseUrl: string;
  let deliveryQueue: FakeDeliveryQueue;

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
    deliveryQueue.enqueued.length = 0;
    await testDb.reset();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await testDb.stop();
  }, 30_000);

  function authed(init: RequestInit = {}): RequestInit {
    return { ...init, headers: { authorization: `Bearer ${OPERATOR_API_KEY}`, ...init.headers } };
  }

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

  async function createEndpoint(
    channelId: string,
    input: { url: string; enabled?: boolean },
  ): Promise<Endpoint> {
    const response = await fetch(
      `${baseUrl}/channels/${channelId}/endpoints`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    );
    return (await response.json()) as Endpoint;
  }

  async function setEndpointEnabled(
    channelId: string,
    endpointId: string,
    enabled: boolean,
  ): Promise<void> {
    await fetch(
      `${baseUrl}/channels/${channelId}/endpoints/${endpointId}`,
      authed({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      }),
    );
  }

  async function ingest(channelId: string, slug: string, body: string): Promise<string> {
    const mintResponse = await fetch(
      `${baseUrl}/channels/${channelId}/tokens`,
      authed({ method: "POST" }),
    );
    const { token } = (await mintResponse.json()) as ChannelTokenCreated;
    const response = await fetch(`${baseUrl}/ingest/${slug}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body,
    });
    const accepted = (await response.json()) as { id: string };
    return accepted.id;
  }

  async function getDetail(channelId: string, broadcastId: string): Promise<BroadcastDetail> {
    const response = await fetch(
      `${baseUrl}/channels/${channelId}/broadcasts/${broadcastId}`,
      authed(),
    );
    return (await response.json()) as BroadcastDetail;
  }

  it("404s for an unknown Channel", async () => {
    const response = await fetch(
      `${baseUrl}/channels/00000000-0000-0000-0000-000000000000/broadcasts/00000000-0000-0000-0000-000000000000/replay`,
      authed({ method: "POST" }),
    );
    expect(response.status).toBe(404);
  });

  it("404s for an unknown Broadcast on a known Channel", async () => {
    const channel = await createChannel("orders");
    const response = await fetch(
      `${baseUrl}/channels/${channel.id}/broadcasts/00000000-0000-0000-0000-000000000000/replay`,
      authed({ method: "POST" }),
    );
    expect(response.status).toBe(404);
  });

  it("202s with a new Broadcast id, fanning out to currently enabled Endpoints without a new ingest", async () => {
    const channel = await createChannel("orders");
    const endpoint = await createEndpoint(channel.id, { url: "https://example.com/hook" });
    const payload = JSON.stringify({ orderId: "abc-123" });
    const originalId = await ingest(channel.id, "orders", payload);

    const response = await fetch(
      `${baseUrl}/channels/${channel.id}/broadcasts/${originalId}/replay`,
      authed({ method: "POST" }),
    );
    expect(response.status).toBe(202);
    const { id: replayId } = (await response.json()) as { id: string };
    expect(replayId).not.toBe(originalId);

    const replayDetail = await getDetail(channel.id, replayId);
    expect(replayDetail.contentType).toBe("application/json");
    expect(replayDetail.body).toBe(payload);
    expect(replayDetail.deliveries).toHaveLength(1);
    expect(replayDetail.deliveries[0]).toMatchObject({
      endpointId: endpoint.id,
      status: "pending",
    });

    // The original Broadcast's own Delivery is untouched by the replay.
    const originalDetail = await getDetail(channel.id, originalId);
    expect(originalDetail.deliveries).toHaveLength(1);

    expect(deliveryQueue.enqueued.map((workItem) => workItem.deliveryId)).toContain(
      replayDetail.deliveries[0]?.id,
    );
  });

  it("fans out to Endpoints enabled at replay time, not at original ingest time", async () => {
    const channel = await createChannel("orders");
    const staysEnabled = await createEndpoint(channel.id, { url: "https://example.com/keep" });
    const getsDisabled = await createEndpoint(channel.id, { url: "https://example.com/drop" });
    const originalId = await ingest(channel.id, "orders", "{}");

    await setEndpointEnabled(channel.id, getsDisabled.id, false);
    const addedLater = await createEndpoint(channel.id, { url: "https://example.com/added" });

    const response = await fetch(
      `${baseUrl}/channels/${channel.id}/broadcasts/${originalId}/replay`,
      authed({ method: "POST" }),
    );
    const { id: replayId } = (await response.json()) as { id: string };

    const replayDetail = await getDetail(channel.id, replayId);
    const replayedEndpointIds = replayDetail.deliveries
      .map((delivery) => delivery.endpointId)
      .sort();
    expect(replayedEndpointIds).toEqual([staysEnabled.id, addedLater.id].sort());
  });

  it("202s with zero Deliveries and enqueues nothing when no Endpoint is currently enabled", async () => {
    const channel = await createChannel("orders");
    const originalId = await ingest(channel.id, "orders", "{}");

    const response = await fetch(
      `${baseUrl}/channels/${channel.id}/broadcasts/${originalId}/replay`,
      authed({ method: "POST" }),
    );
    expect(response.status).toBe(202);
    const { id: replayId } = (await response.json()) as { id: string };

    const replayDetail = await getDetail(channel.id, replayId);
    expect(replayDetail.deliveries).toEqual([]);
    expect(deliveryQueue.enqueued).toEqual([]);
  });

  it("replaying twice creates two independent sets of Deliveries", async () => {
    const channel = await createChannel("orders");
    const endpoint = await createEndpoint(channel.id, { url: "https://example.com/hook" });
    const originalId = await ingest(channel.id, "orders", "{}");

    const firstReplay = await fetch(
      `${baseUrl}/channels/${channel.id}/broadcasts/${originalId}/replay`,
      authed({ method: "POST" }),
    );
    const { id: firstReplayId } = (await firstReplay.json()) as { id: string };

    const secondReplay = await fetch(
      `${baseUrl}/channels/${channel.id}/broadcasts/${originalId}/replay`,
      authed({ method: "POST" }),
    );
    expect(secondReplay.status).toBe(202);
    const { id: secondReplayId } = (await secondReplay.json()) as { id: string };

    expect(secondReplayId).not.toBe(firstReplayId);
    const firstDetail = await getDetail(channel.id, firstReplayId);
    const secondDetail = await getDetail(channel.id, secondReplayId);
    expect(firstDetail.deliveries).toHaveLength(1);
    expect(secondDetail.deliveries).toHaveLength(1);
    expect(firstDetail.deliveries[0]?.endpointId).toBe(endpoint.id);
    expect(secondDetail.deliveries[0]?.endpointId).toBe(endpoint.id);
    expect(firstDetail.deliveries[0]?.id).not.toBe(secondDetail.deliveries[0]?.id);
  });
});

/**
 * Issue #84: the Endpoint-scoped half of the failure roll-up —
 * `GET /channels/:channelId/broadcasts?endpointId=&status=failed`, additive
 * to the existing unfiltered call.
 */
describe("Channel Activity — Endpoint-scoped failures (GET .../broadcasts?endpointId=&status=failed)", () => {
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
  ): Promise<{ broadcastId: string; deliveryId: string }> {
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
      n: 3,
      statusCode: status === "succeeded" ? 200 : 503,
      durationMs: 42,
      error: status === "succeeded" ? null : "boom",
      status,
      at: now,
    });
    return { broadcastId: broadcast.id, deliveryId: delivery.id };
  }

  it("400s when endpointId is given without status", async () => {
    const channel = await createChannel("orders");
    const endpoint = await createEndpoint(channel.id, "https://example.com/hook");
    const response = await fetch(
      `${baseUrl}/channels/${channel.id}/broadcasts?endpointId=${endpoint.id}`,
      authed(),
    );
    expect(response.status).toBe(400);
  });

  it("400s when status is given without endpointId", async () => {
    const channel = await createChannel("orders");
    const response = await fetch(
      `${baseUrl}/channels/${channel.id}/broadcasts?status=failed`,
      authed(),
    );
    expect(response.status).toBe(400);
  });

  it("returns only Broadcasts whose Delivery to that Endpoint failed or dead-lettered, with the Delivery facts inlined", async () => {
    const now = new Date();
    const channel = await createChannel("orders");
    const target = await createEndpoint(channel.id, "https://example.com/target");
    const other = await createEndpoint(channel.id, "https://example.com/other");

    const { broadcastId: succeededId } = await deliverOne(channel.id, target.id, "succeeded", now);
    const { broadcastId: failedId, deliveryId: failedDeliveryId } = await deliverOne(
      channel.id,
      target.id,
      "failed",
      now,
    );
    const { broadcastId: deadLetteredId } = await deliverOne(
      channel.id,
      target.id,
      "dead_lettered",
      now,
    );
    // A failure on a different Endpoint must never leak into this Endpoint's view.
    await deliverOne(channel.id, other.id, "failed", now);

    const response = await fetch(
      `${baseUrl}/channels/${channel.id}/broadcasts?endpointId=${target.id}&status=failed`,
      authed(),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as BroadcastList;

    const ids = body.items.map((item) => item.id);
    expect(ids).toContain(failedId);
    expect(ids).toContain(deadLetteredId);
    expect(ids).not.toContain(succeededId);

    const failedItem = body.items.find((item) => item.id === failedId);
    expect(failedItem?.delivery).toMatchObject({
      deliveryId: failedDeliveryId,
      status: "failed",
      lastStatusCode: 503,
      lastDurationMs: 42,
      lastError: "boom",
      attemptCount: 3,
    });
  });

  it("orders newest first and paginates with the existing keyset cursor", async () => {
    const now = new Date();
    const channel = await createChannel("orders");
    const endpoint = await createEndpoint(channel.id, "https://example.com/target");

    const first = await deliverOne(channel.id, endpoint.id, "failed", now);
    const second = await deliverOne(
      channel.id,
      endpoint.id,
      "dead_lettered",
      new Date(now.getTime() + 1_000),
    );
    const third = await deliverOne(
      channel.id,
      endpoint.id,
      "failed",
      new Date(now.getTime() + 2_000),
    );

    const firstPage = await fetch(
      `${baseUrl}/channels/${channel.id}/broadcasts?endpointId=${endpoint.id}&status=failed&limit=2`,
      authed(),
    );
    const firstBody = (await firstPage.json()) as BroadcastList;
    expect(firstBody.items.map((item) => item.id)).toEqual([third.broadcastId, second.broadcastId]);
    expect(firstBody.nextCursor).toEqual(expect.any(String));

    const secondPage = await fetch(
      `${baseUrl}/channels/${channel.id}/broadcasts?endpointId=${endpoint.id}&status=failed&limit=2&cursor=${encodeURIComponent(firstBody.nextCursor ?? "")}`,
      authed(),
    );
    const secondBody = (await secondPage.json()) as BroadcastList;
    expect(secondBody.items.map((item) => item.id)).toEqual([first.broadcastId]);
    expect(secondBody.nextCursor).toBeNull();
  });

  it("leaves the unfiltered call's response shape unchanged (no delivery field)", async () => {
    const now = new Date();
    const channel = await createChannel("orders");
    const endpoint = await createEndpoint(channel.id, "https://example.com/target");
    await deliverOne(channel.id, endpoint.id, "failed", now);

    const response = await fetch(`${baseUrl}/channels/${channel.id}/broadcasts`, authed());
    const body = (await response.json()) as BroadcastList;
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).not.toHaveProperty("delivery");
  });

  it("400s on a malformed cursor with endpointId+status set", async () => {
    const channel = await createChannel("orders");
    const endpoint = await createEndpoint(channel.id, "https://example.com/target");
    const response = await fetch(
      `${baseUrl}/channels/${channel.id}/broadcasts?endpointId=${endpoint.id}&status=failed&cursor=not-base64url-json`,
      authed(),
    );
    expect(response.status).toBe(400);
  });
});
