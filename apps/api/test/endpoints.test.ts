import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import type { Channel, Endpoint, EndpointList } from "@webhook-broadcast/contract";
import {
  completeDelivery,
  createDeliveriesForBroadcast,
  insertBroadcast,
  updateEndpoint,
} from "@webhook-broadcast/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { FakeDeliveryQueue } from "./fakeDeliveryQueue.js";
import { startTestDb, type TestDb } from "./testDb.js";

const OPERATOR_API_KEY = "test-operator-key";
const COOKIE_NAME = "wb_operator";

describe("Endpoint CRUD (HTTP admin seam)", () => {
  let testDb: TestDb;
  let server: Server;
  let baseUrl: string;
  let channel: Channel;

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

  beforeEach(async () => {
    const createChannelResponse = await fetch(
      `${baseUrl}/channels`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "orders" }),
      }),
    );
    channel = (await createChannelResponse.json()) as Channel;
  });

  afterEach(async () => {
    await testDb.reset();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await testDb.stop();
  }, 30_000);

  it("creates, lists, gets, and patches an Endpoint owned by the Channel", async () => {
    const createResponse = await fetch(
      `${baseUrl}/channels/${channel.id}/endpoints`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://example.com/hook",
          name: "Primary",
          timeoutMs: 5000,
          headers: { "x-api-key": "secret" },
        }),
      }),
    );
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as Endpoint;
    expect(created).toMatchObject({
      channelId: channel.id,
      url: "https://example.com/hook",
      name: "Primary",
      timeoutMs: 5000,
      headers: { "x-api-key": "secret" },
      enabled: true,
    });
    expect(created.id).toEqual(expect.any(String));

    const listResponse = await fetch(`${baseUrl}/channels/${channel.id}/endpoints`, authed());
    expect(listResponse.status).toBe(200);
    const list = (await listResponse.json()) as EndpointList;
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ id: created.id, url: "https://example.com/hook" });
    expect(list.nextCursor).toBeNull();

    const getResponse = await fetch(
      `${baseUrl}/channels/${channel.id}/endpoints/${created.id}`,
      authed(),
    );
    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toMatchObject({ id: created.id, name: "Primary" });

    const patchResponse = await fetch(
      `${baseUrl}/channels/${channel.id}/endpoints/${created.id}`,
      authed({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Renamed", enabled: false }),
      }),
    );
    expect(patchResponse.status).toBe(200);
    const patched = (await patchResponse.json()) as Endpoint;
    expect(patched).toMatchObject({ id: created.id, name: "Renamed", enabled: false });
  });

  it("defaults optional fields when omitted from the create payload", async () => {
    const createResponse = await fetch(
      `${baseUrl}/channels/${channel.id}/endpoints`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/minimal" }),
      }),
    );
    expect(createResponse.status).toBe(201);
    await expect(createResponse.json()).resolves.toMatchObject({
      name: null,
      timeoutMs: null,
      headers: {},
      enabled: true,
    });
  });

  it("filters the list by exact url, and finds nothing for an unknown url", async () => {
    await fetch(
      `${baseUrl}/channels/${channel.id}/endpoints`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/hook-a" }),
      }),
    );
    await fetch(
      `${baseUrl}/channels/${channel.id}/endpoints`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/hook-b" }),
      }),
    );

    const response = await fetch(
      `${baseUrl}/channels/${channel.id}/endpoints?url=${encodeURIComponent("https://example.com/hook-a")}`,
      authed(),
    );
    expect(response.status).toBe(200);
    const list = (await response.json()) as EndpointList;
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ url: "https://example.com/hook-a" });
    expect(list.nextCursor).toBeNull();

    const missResponse = await fetch(
      `${baseUrl}/channels/${channel.id}/endpoints?url=${encodeURIComponent("https://example.com/unknown")}`,
      authed(),
    );
    expect(missResponse.status).toBe(200);
    await expect(missResponse.json()).resolves.toMatchObject({ items: [], nextCursor: null });
  });

  it("scopes the url filter to its own Channel, since the same url may exist on another", async () => {
    const otherChannelResponse = await fetch(
      `${baseUrl}/channels`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "invoices" }),
      }),
    );
    const otherChannel = (await otherChannelResponse.json()) as Channel;

    const sharedUrl = "https://example.com/shared-hook";
    for (const target of [channel, otherChannel]) {
      await fetch(
        `${baseUrl}/channels/${target.id}/endpoints`,
        authed({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: sharedUrl }),
        }),
      );
    }

    const response = await fetch(
      `${baseUrl}/channels/${channel.id}/endpoints?url=${encodeURIComponent(sharedUrl)}`,
      authed(),
    );
    expect(response.status).toBe(200);
    const list = (await response.json()) as EndpointList;
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ url: sharedUrl, channelId: channel.id });
  });

  it("rejects a duplicate url on the same Channel with a conflict envelope", async () => {
    await fetch(
      `${baseUrl}/channels/${channel.id}/endpoints`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/dup" }),
      }),
    );
    const response = await fetch(
      `${baseUrl}/channels/${channel.id}/endpoints`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/dup" }),
      }),
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "conflict" } });
  });

  it("allows the same url on a different Channel — Endpoints are per-Channel (ADR 0001)", async () => {
    const otherChannelResponse = await fetch(
      `${baseUrl}/channels`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "invoices" }),
      }),
    );
    const otherChannel = (await otherChannelResponse.json()) as Channel;

    await fetch(
      `${baseUrl}/channels/${channel.id}/endpoints`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/shared" }),
      }),
    );
    const response = await fetch(
      `${baseUrl}/channels/${otherChannel.id}/endpoints`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/shared" }),
      }),
    );
    expect(response.status).toBe(201);
  });

  it("rejects an invalid url with a validation_failed envelope", async () => {
    const response = await fetch(
      `${baseUrl}/channels/${channel.id}/endpoints`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "not-a-url" }),
      }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "validation_failed" },
    });
  });

  it("rejects a timeoutMs above the contract maximum", async () => {
    const response = await fetch(
      `${baseUrl}/channels/${channel.id}/endpoints`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/hook", timeoutMs: 3_600_001 }),
      }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "validation_failed" },
    });
  });

  it("rejects patching an endpoint's timeoutMs above the contract maximum", async () => {
    const createResponse = await fetch(
      `${baseUrl}/channels/${channel.id}/endpoints`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/timeout-patch" }),
      }),
    );
    const created = (await createResponse.json()) as Endpoint;

    const patchResponse = await fetch(
      `${baseUrl}/channels/${channel.id}/endpoints/${created.id}`,
      authed({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ timeoutMs: 3_600_001 }),
      }),
    );
    expect(patchResponse.status).toBe(400);
    await expect(patchResponse.json()).resolves.toMatchObject({
      error: { code: "validation_failed" },
    });
  });

  it("rejects private and metadata endpoint URLs", async () => {
    for (const url of [
      "http://example.com/hook",
      "https://127.0.0.1/hook",
      "https://169.254.169.254/latest/meta-data",
      "https://10.0.0.1/hook",
    ]) {
      const response = await fetch(
        `${baseUrl}/channels/${channel.id}/endpoints`,
        authed({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url }),
        }),
      );
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "validation_failed" },
      });
    }
  });

  it("rejects patching an endpoint URL to a blocked target", async () => {
    const createResponse = await fetch(
      `${baseUrl}/channels/${channel.id}/endpoints`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/safe" }),
      }),
    );
    const created = (await createResponse.json()) as Endpoint;

    const patchResponse = await fetch(
      `${baseUrl}/channels/${channel.id}/endpoints/${created.id}`,
      authed({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://127.0.0.1/hook" }),
      }),
    );
    expect(patchResponse.status).toBe(400);
    await expect(patchResponse.json()).resolves.toMatchObject({
      error: { code: "validation_failed" },
    });
  });

  it("404s creating/listing/getting/patching Endpoints under an unknown Channel id", async () => {
    const unknownChannelId = "00000000-0000-0000-0000-000000000000";

    const createResponse = await fetch(
      `${baseUrl}/channels/${unknownChannelId}/endpoints`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/x" }),
      }),
    );
    expect(createResponse.status).toBe(404);

    const listResponse = await fetch(`${baseUrl}/channels/${unknownChannelId}/endpoints`, authed());
    expect(listResponse.status).toBe(404);
  });

  it("404s for a get/patch on an unknown Endpoint id within a known Channel", async () => {
    const unknownEndpointId = "00000000-0000-0000-0000-000000000000";

    const getResponse = await fetch(
      `${baseUrl}/channels/${channel.id}/endpoints/${unknownEndpointId}`,
      authed(),
    );
    expect(getResponse.status).toBe(404);

    const patchResponse = await fetch(
      `${baseUrl}/channels/${channel.id}/endpoints/${unknownEndpointId}`,
      authed({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      }),
    );
    expect(patchResponse.status).toBe(404);
  });

  it("404s for an Endpoint fetched through a Channel it does not belong to", async () => {
    const otherChannelResponse = await fetch(
      `${baseUrl}/channels`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "invoices-2" }),
      }),
    );
    const otherChannel = (await otherChannelResponse.json()) as Channel;

    const createResponse = await fetch(
      `${baseUrl}/channels/${channel.id}/endpoints`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/owned" }),
      }),
    );
    const created = (await createResponse.json()) as Endpoint;

    const response = await fetch(
      `${baseUrl}/channels/${otherChannel.id}/endpoints/${created.id}`,
      authed(),
    );
    expect(response.status).toBe(404);
  });

  it("lists health aggregates and auto-disabled state on the Endpoints tab API", async () => {
    const createResponse = await fetch(
      `${baseUrl}/channels/${channel.id}/endpoints`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/health" }),
      }),
    );
    const created = (await createResponse.json()) as Endpoint;
    const now = new Date();

    const broadcast = await insertBroadcast(testDb.db, {
      id: randomUUID(),
      channelId: channel.id,
      receivedAt: now,
      contentType: "application/json",
      body: Buffer.from("{}"),
      headers: {},
    });
    const [succeededDelivery] = await createDeliveriesForBroadcast(testDb.db, {
      broadcastId: broadcast.id,
      channelId: channel.id,
      endpointIds: [created.id],
      now,
    });
    if (!succeededDelivery) {
      throw new Error("expected Delivery");
    }
    await completeDelivery(testDb.db, {
      deliveryId: succeededDelivery.id,
      n: 1,
      statusCode: 200,
      durationMs: 100,
      error: null,
      status: "succeeded",
      at: now,
    });

    const failBroadcast = await insertBroadcast(testDb.db, {
      id: randomUUID(),
      channelId: channel.id,
      receivedAt: now,
      contentType: "application/json",
      body: Buffer.from("{}"),
      headers: {},
    });
    const [failedDelivery] = await createDeliveriesForBroadcast(testDb.db, {
      broadcastId: failBroadcast.id,
      channelId: channel.id,
      endpointIds: [created.id],
      now,
    });
    if (!failedDelivery) {
      throw new Error("expected Delivery");
    }
    await completeDelivery(testDb.db, {
      deliveryId: failedDelivery.id,
      n: 1,
      statusCode: 404,
      durationMs: 200,
      error: null,
      status: "failed",
      at: now,
    });

    await updateEndpoint(testDb.db, channel.id, created.id, {
      enabled: false,
      autoDisabledAt: now,
      updatedAt: now,
    });

    const listResponse = await fetch(`${baseUrl}/channels/${channel.id}/endpoints`, authed());
    expect(listResponse.status).toBe(200);
    const list = (await listResponse.json()) as EndpointList;
    expect(list.items[0]).toMatchObject({
      id: created.id,
      enabled: false,
      autoDisabledAt: now.toISOString(),
      successRate24h: 0.5,
      lastSuccessAt: now.toISOString(),
    });
    expect(list.items[0]?.p95Ms).toEqual(expect.any(Number));
  });

  it("re-enables an auto-disabled Endpoint and clears autoDisabledAt", async () => {
    const createResponse = await fetch(
      `${baseUrl}/channels/${channel.id}/endpoints`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/re-enable" }),
      }),
    );
    const created = (await createResponse.json()) as Endpoint;
    const disabledAt = new Date("2026-08-10T12:00:00.000Z");
    await updateEndpoint(testDb.db, channel.id, created.id, {
      enabled: false,
      autoDisabledAt: disabledAt,
      updatedAt: disabledAt,
    });

    const patchResponse = await fetch(
      `${baseUrl}/channels/${channel.id}/endpoints/${created.id}`,
      authed({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      }),
    );
    expect(patchResponse.status).toBe(200);
    const patched = (await patchResponse.json()) as Endpoint;
    expect(patched).toMatchObject({
      id: created.id,
      enabled: true,
      autoDisabledAt: null,
    });
  });

  it("deletes an Endpoint, freeing its (channelId, url) for a fresh create (issue #36)", async () => {
    const createResponse = await fetch(
      `${baseUrl}/channels/${channel.id}/endpoints`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/reclaim" }),
      }),
    );
    const created = (await createResponse.json()) as Endpoint;

    const deleteResponse = await fetch(
      `${baseUrl}/channels/${channel.id}/endpoints/${created.id}`,
      authed({ method: "DELETE" }),
    );
    expect(deleteResponse.status).toBe(204);

    const getResponse = await fetch(
      `${baseUrl}/channels/${channel.id}/endpoints/${created.id}`,
      authed(),
    );
    expect(getResponse.status).toBe(404);

    const recreateResponse = await fetch(
      `${baseUrl}/channels/${channel.id}/endpoints`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/reclaim" }),
      }),
    );
    expect(recreateResponse.status).toBe(201);
  });

  it("deletes an Endpoint with Delivery/Attempt history via cascade (issue #36)", async () => {
    const createResponse = await fetch(
      `${baseUrl}/channels/${channel.id}/endpoints`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/history" }),
      }),
    );
    const created = (await createResponse.json()) as Endpoint;
    const now = new Date();

    const broadcast = await insertBroadcast(testDb.db, {
      id: randomUUID(),
      channelId: channel.id,
      receivedAt: now,
      contentType: "application/json",
      body: Buffer.from("{}"),
      headers: {},
    });
    const [delivery] = await createDeliveriesForBroadcast(testDb.db, {
      broadcastId: broadcast.id,
      channelId: channel.id,
      endpointIds: [created.id],
      now,
    });
    if (!delivery) {
      throw new Error("expected Delivery");
    }
    await completeDelivery(testDb.db, {
      deliveryId: delivery.id,
      n: 1,
      statusCode: 200,
      durationMs: 100,
      error: null,
      status: "succeeded",
      at: now,
    });

    const deleteResponse = await fetch(
      `${baseUrl}/channels/${channel.id}/endpoints/${created.id}`,
      authed({ method: "DELETE" }),
    );
    expect(deleteResponse.status).toBe(204);
  });

  it("404s deleting an unknown Endpoint id, and again for a repeat delete", async () => {
    const createResponse = await fetch(
      `${baseUrl}/channels/${channel.id}/endpoints`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/double-delete" }),
      }),
    );
    const created = (await createResponse.json()) as Endpoint;

    const unknownEndpointId = "00000000-0000-0000-0000-000000000000";
    const unknownResponse = await fetch(
      `${baseUrl}/channels/${channel.id}/endpoints/${unknownEndpointId}`,
      authed({ method: "DELETE" }),
    );
    expect(unknownResponse.status).toBe(404);

    const firstDelete = await fetch(
      `${baseUrl}/channels/${channel.id}/endpoints/${created.id}`,
      authed({ method: "DELETE" }),
    );
    expect(firstDelete.status).toBe(204);

    const secondDelete = await fetch(
      `${baseUrl}/channels/${channel.id}/endpoints/${created.id}`,
      authed({ method: "DELETE" }),
    );
    expect(secondDelete.status).toBe(404);
  });

  it("404s deleting an Endpoint through a Channel it does not belong to, leaving it intact", async () => {
    const otherChannelResponse = await fetch(
      `${baseUrl}/channels`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "invoices-3" }),
      }),
    );
    const otherChannel = (await otherChannelResponse.json()) as Channel;

    const createResponse = await fetch(
      `${baseUrl}/channels/${channel.id}/endpoints`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/owned-delete" }),
      }),
    );
    const created = (await createResponse.json()) as Endpoint;

    // Guards the `channelId` predicate in `deleteEndpoint` itself: unlike the
    // unknown-Channel case, `requireChannel` passes here, so the repository
    // scoping is the only thing standing between a known Channel and another
    // Channel's Endpoint.
    const response = await fetch(
      `${baseUrl}/channels/${otherChannel.id}/endpoints/${created.id}`,
      authed({ method: "DELETE" }),
    );
    expect(response.status).toBe(404);

    const stillThere = await fetch(
      `${baseUrl}/channels/${channel.id}/endpoints/${created.id}`,
      authed(),
    );
    expect(stillThere.status).toBe(200);
  });

  it("404s deleting an Endpoint under an unknown Channel id", async () => {
    const unknownChannelId = "00000000-0000-0000-0000-000000000000";
    const createResponse = await fetch(
      `${baseUrl}/channels/${channel.id}/endpoints`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/wrong-channel" }),
      }),
    );
    const created = (await createResponse.json()) as Endpoint;

    const response = await fetch(
      `${baseUrl}/channels/${unknownChannelId}/endpoints/${created.id}`,
      authed({ method: "DELETE" }),
    );
    expect(response.status).toBe(404);
  });
});
