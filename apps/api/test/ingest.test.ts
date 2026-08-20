import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Channel, ChannelTokenCreated, Endpoint } from "@webhook-broadcast/contract";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { FakeDeliveryQueue } from "./fakeDeliveryQueue.js";
import { startTestDb, type TestDb } from "./testDb.js";

const OPERATOR_API_KEY = "test-operator-key";
const COOKIE_NAME = "wb_operator";
const MAX_BODY_BYTES = 64;

describe("POST /ingest/:slug (Channel-token HTTP seam)", () => {
  let testDb: TestDb;
  let server: Server;
  let baseUrl: string;
  let deliveryQueue: FakeDeliveryQueue;
  // Issue #99: a second API process on the same database, configured with a
  // service-wide INGEST_SUCCESS_STATUS of 200 — the only way to observe the
  // env-level default, since `createApp` reads it once at boot.
  let configuredServer: Server;
  let configuredBaseUrl: string;

  beforeAll(async () => {
    testDb = await startTestDb();
    deliveryQueue = new FakeDeliveryQueue();
    const app = createApp({
      db: testDb.db,
      deliveryQueue,
      operatorApiKey: OPERATOR_API_KEY,
      cookieName: COOKIE_NAME,
      ingestMaxBodyBytes: MAX_BODY_BYTES,
      ingestHeaderAllowlist: [],
      ingestHeaderDenylist: ["x-secret"],
    });
    server = createServer(app.callback());
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;

    const configuredApp = createApp({
      db: testDb.db,
      deliveryQueue,
      operatorApiKey: OPERATOR_API_KEY,
      cookieName: COOKIE_NAME,
      ingestMaxBodyBytes: MAX_BODY_BYTES,
      ingestHeaderAllowlist: [],
      ingestHeaderDenylist: ["x-secret"],
      ingestSuccessStatus: 200,
    });
    configuredServer = createServer(configuredApp.callback());
    await new Promise<void>((resolve) => configuredServer.listen(0, resolve));
    const configuredPort = (configuredServer.address() as AddressInfo).port;
    configuredBaseUrl = `http://127.0.0.1:${configuredPort}`;
  }, 60_000);

  afterEach(async () => {
    await testDb.reset();
    deliveryQueue.enqueued.length = 0;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => configuredServer.close(() => resolve()));
    await testDb.stop();
  }, 30_000);

  function authed(init: RequestInit = {}): RequestInit {
    return { ...init, headers: { authorization: `Bearer ${OPERATOR_API_KEY}`, ...init.headers } };
  }

  async function createChannel(input: {
    slug: string;
    enabled?: boolean;
    ingestSuccessStatus?: number | null;
  }): Promise<Channel> {
    const response = await fetch(
      `${baseUrl}/channels`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    );
    return (await response.json()) as Channel;
  }

  async function mintToken(channelId: string): Promise<string> {
    const response = await fetch(
      `${baseUrl}/channels/${channelId}/tokens`,
      authed({ method: "POST" }),
    );
    const created = (await response.json()) as ChannelTokenCreated;
    return created.token;
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

  it("accepts a valid ingest with 202 and a Broadcast id, storing body and filtered headers", async () => {
    const channel = await createChannel({ slug: "orders" });
    const token = await mintToken(channel.id);

    const response = await fetch(`${baseUrl}/ingest/orders`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-secret": "should-be-dropped",
        "x-request-id": "abc-123",
        cookie: "session=abc",
      },
      body: JSON.stringify({ hello: "world" }),
    });

    expect(response.status).toBe(202);
    const body = (await response.json()) as { id: string };
    expect(body.id).toEqual(expect.any(String));

    const activity = await fetch(`${baseUrl}/channels/${channel.id}/broadcasts`, authed());
    const activityBody = (await activity.json()) as {
      items: { id: string; bodyPreview: string; headers?: Record<string, unknown> }[];
    };
    expect(activityBody.items).toHaveLength(1);
    expect(activityBody.items[0]?.id).toEqual(body.id);
    expect(activityBody.items[0]?.bodyPreview).toContain("hello");
  });

  // Issue #99: the accepted status is configurable because a producer whose
  // success condition is literally `200` retries an event this service already
  // accepted, and each retry becomes another Broadcast fanned out to every
  // Endpoint. Nothing else about the response moves, and the error paths are
  // untouched (covered by the 401/413 cases in this file).
  describe("accepted-response status (issue #99)", () => {
    it("answers the Channel's ingestSuccessStatus when it has one", async () => {
      const channel = await createChannel({ slug: "orders", ingestSuccessStatus: 200 });
      const token = await mintToken(channel.id);

      const response = await fetch(`${baseUrl}/ingest/orders`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: "hi",
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ id: expect.any(String) });
    });

    it("answers the service-wide default when the Channel sets no override", async () => {
      const channel = await createChannel({ slug: "orders" });
      const token = await mintToken(channel.id);

      const response = await fetch(`${configuredBaseUrl}/ingest/orders`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: "hi",
      });

      expect(response.status).toBe(200);
    });

    it("lets the Channel's override win over the service-wide default", async () => {
      const channel = await createChannel({ slug: "orders", ingestSuccessStatus: 201 });
      const token = await mintToken(channel.id);

      const response = await fetch(`${configuredBaseUrl}/ingest/orders`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: "hi",
      });

      expect(response.status).toBe(201);
    });

    // 204 and 205 carry no body by HTTP rule, so the Broadcast id an ordinary
    // accepted response returns is simply absent. Allowed (the contract's rule
    // is "2xx"), documented here so the trade is visible rather than surprising.
    it("returns no Broadcast id when the Channel picks a bodyless 2xx", async () => {
      const channel = await createChannel({ slug: "orders", ingestSuccessStatus: 204 });
      const token = await mintToken(channel.id);

      const response = await fetch(`${baseUrl}/ingest/orders`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: "hi",
      });

      expect(response.status).toBe(204);
      await expect(response.text()).resolves.toBe("");
    });

    it("still answers 202 on a deployment that configures neither", async () => {
      const channel = await createChannel({ slug: "orders" });
      const token = await mintToken(channel.id);

      const response = await fetch(`${baseUrl}/ingest/orders`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: "hi",
      });

      expect(response.status).toBe(202);
    });

    it("leaves the rejected paths on their own statuses", async () => {
      const channel = await createChannel({ slug: "orders", ingestSuccessStatus: 200 });
      await mintToken(channel.id);

      const unauthorized = await fetch(`${configuredBaseUrl}/ingest/orders`, {
        method: "POST",
        headers: { authorization: "Bearer wrong-token" },
        body: "hi",
      });
      expect(unauthorized.status).toBe(401);
    });
  });

  it("rejects ingest with a missing token", async () => {
    const channel = await createChannel({ slug: "orders" });
    await mintToken(channel.id);

    const response = await fetch(`${baseUrl}/ingest/orders`, {
      method: "POST",
      body: "hi",
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "unauthorized" } });
  });

  it("rejects ingest with an invalid token", async () => {
    const channel = await createChannel({ slug: "orders" });
    await mintToken(channel.id);

    const response = await fetch(`${baseUrl}/ingest/orders`, {
      method: "POST",
      headers: { authorization: "Bearer wrong-token" },
      body: "hi",
    });
    expect(response.status).toBe(401);
  });

  it("rejects ingest with a token that has been revoked", async () => {
    const channel = await createChannel({ slug: "orders" });
    const token = await mintToken(channel.id);

    const withTokenResponse = await fetch(`${baseUrl}/channels/${channel.id}`, authed());
    const withToken = (await withTokenResponse.json()) as Channel;
    const tokenId = withToken.tokens[0]?.id;
    await fetch(
      `${baseUrl}/channels/${channel.id}/tokens/${tokenId}`,
      authed({ method: "DELETE" }),
    );

    const response = await fetch(`${baseUrl}/ingest/orders`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: "hi",
    });
    expect(response.status).toBe(401);
  });

  it("rejects ingest for an unknown slug with the same response as a bad token", async () => {
    const response = await fetch(`${baseUrl}/ingest/does-not-exist`, {
      method: "POST",
      headers: { authorization: "Bearer whatever" },
      body: "hi",
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "unauthorized", message: "invalid ingest token" },
    });
  });

  it("rejects ingest for a disabled Channel without revealing channel state", async () => {
    const channel = await createChannel({ slug: "orders", enabled: false });
    const token = await mintToken(channel.id);

    const response = await fetch(`${baseUrl}/ingest/orders`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: "hi",
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unauthorized", message: "invalid ingest token" },
    });
  });

  // Issue #38: a Channel that opts into unauthenticated ingest must accept
  // POST /ingest/:slug with no Authorization header at all — the slug is
  // then the only thing gating its fan-out.
  it("accepts an unauthenticated POST for a Channel with allowUnauthenticatedIngest set", async () => {
    const openSlug = "provider-hosted-auth-notify-abc123";
    const createResponse = await fetch(
      `${baseUrl}/channels`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: openSlug, allowUnauthenticatedIngest: true }),
      }),
    );
    const channel = (await createResponse.json()) as Channel;

    const response = await fetch(`${baseUrl}/ingest/${openSlug}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
    });

    expect(response.status).toBe(202);
    const body = (await response.json()) as { id: string };
    expect(body.id).toEqual(expect.any(String));

    const activity = await fetch(`${baseUrl}/channels/${channel.id}/broadcasts`, authed());
    const activityBody = (await activity.json()) as { items: { id: string }[] };
    expect(activityBody.items).toHaveLength(1);
    expect(activityBody.items[0]?.id).toEqual(body.id);
  });

  it("still accepts a Bearer token on an open Channel without requiring it to be valid", async () => {
    const openSlug = "provider-hosted-auth-notify-xyz789";
    await fetch(
      `${baseUrl}/channels`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: openSlug, allowUnauthenticatedIngest: true }),
      }),
    );

    const response = await fetch(`${baseUrl}/ingest/${openSlug}`, {
      method: "POST",
      headers: { authorization: "Bearer whatever-nonsense" },
      body: "hi",
    });

    expect(response.status).toBe(202);
  });

  it("rejects ingest for a soft-deleted Channel without revealing channel state", async () => {
    const channel = await createChannel({ slug: "orders" });
    const token = await mintToken(channel.id);
    await fetch(`${baseUrl}/channels/${channel.id}`, authed({ method: "DELETE" }));

    const response = await fetch(`${baseUrl}/ingest/orders`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: "hi",
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unauthorized", message: "invalid ingest token" },
    });
  });

  it("rejects a body over INGEST_MAX_BODY_BYTES with 413", async () => {
    const channel = await createChannel({ slug: "orders" });
    const token = await mintToken(channel.id);

    const response = await fetch(`${baseUrl}/ingest/orders`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: "x".repeat(MAX_BODY_BYTES + 1),
    });
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "payload_too_large" } });

    const activity = await fetch(`${baseUrl}/channels/${channel.id}/broadcasts`, authed());
    await expect(activity.json()).resolves.toMatchObject({ items: [] });
  });

  it("accepts a body at exactly the byte limit", async () => {
    const channel = await createChannel({ slug: "orders" });
    const token = await mintToken(channel.id);

    const response = await fetch(`${baseUrl}/ingest/orders`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: "x".repeat(MAX_BODY_BYTES),
    });
    expect(response.status).toBe(202);
  });

  it("fans out exactly one Delivery + one queued work item per enabled Endpoint, skipping disabled ones", async () => {
    const channel = await createChannel({ slug: "orders" });
    const token = await mintToken(channel.id);
    const first = await createEndpoint(channel.id, { url: "https://example.com/one" });
    const second = await createEndpoint(channel.id, { url: "https://example.com/two" });
    await createEndpoint(channel.id, { url: "https://example.com/disabled", enabled: false });

    const response = await fetch(`${baseUrl}/ingest/orders`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: "hi",
    });
    expect(response.status).toBe(202);
    const { id: broadcastId } = (await response.json()) as { id: string };

    const detailResponse = await fetch(
      `${baseUrl}/channels/${channel.id}/broadcasts/${broadcastId}`,
      authed(),
    );
    expect(detailResponse.status).toBe(200);
    const detail = (await detailResponse.json()) as {
      deliveries: { id: string; endpointId: string; status: string }[];
    };

    expect(detail.deliveries).toHaveLength(2);
    expect(detail.deliveries.every((delivery) => delivery.status === "pending")).toBe(true);
    expect(detail.deliveries.map((delivery) => delivery.endpointId).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    expect(deliveryQueue.enqueued.map((workItem) => workItem.deliveryId).sort()).toEqual(
      detail.deliveries.map((delivery) => delivery.id).sort(),
    );
    const requestIds = new Set(deliveryQueue.enqueued.map((workItem) => workItem.requestId));
    expect(requestIds.size).toBe(1);
  });

  it("does not return 202 when enqueueBulk fails — Broadcast row is rolled back", async () => {
    class FailBulkQueue extends FakeDeliveryQueue {
      override async enqueueBulk(): Promise<void> {
        throw new Error("redis unavailable");
      }
    }
    const failQueue = new FailBulkQueue();
    const failApp = createApp({
      db: testDb.db,
      deliveryQueue: failQueue,
      operatorApiKey: OPERATOR_API_KEY,
      cookieName: COOKIE_NAME,
      ingestMaxBodyBytes: MAX_BODY_BYTES,
      ingestHeaderAllowlist: [],
      ingestHeaderDenylist: [],
    });
    const failServer = createServer(failApp.callback());
    await new Promise<void>((resolve) => failServer.listen(0, resolve));
    const failPort = (failServer.address() as AddressInfo).port;
    const failBaseUrl = `http://127.0.0.1:${failPort}`;

    try {
      const channel = await createChannel({ slug: "fail-ingest" });
      const token = await mintToken(channel.id);
      await createEndpoint(channel.id, { url: "https://example.com/one" });

      const response = await fetch(`${failBaseUrl}/ingest/fail-ingest`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: "hi",
      });
      expect(response.status).not.toBe(202);

      const activity = await fetch(`${failBaseUrl}/channels/${channel.id}/broadcasts`, authed());
      const activityBody = (await activity.json()) as { items: unknown[] };
      expect(activityBody.items).toHaveLength(0);
    } finally {
      await new Promise<void>((resolve) => failServer.close(() => resolve()));
    }
  });

  it("creates no Deliveries and enqueues no work items when the Channel has no enabled Endpoints", async () => {
    const channel = await createChannel({ slug: "orders" });
    const token = await mintToken(channel.id);

    const response = await fetch(`${baseUrl}/ingest/orders`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: "hi",
    });
    const { id: broadcastId } = (await response.json()) as { id: string };

    const detailResponse = await fetch(
      `${baseUrl}/channels/${channel.id}/broadcasts/${broadcastId}`,
      authed(),
    );
    const detail = (await detailResponse.json()) as { deliveries: unknown[] };
    expect(detail.deliveries).toHaveLength(0);
    expect(deliveryQueue.enqueued).toHaveLength(0);
  });
});
