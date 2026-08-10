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
});
