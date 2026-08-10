import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { BroadcastList, Channel, ChannelTokenCreated } from "@webhook-broadcast/contract";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
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
