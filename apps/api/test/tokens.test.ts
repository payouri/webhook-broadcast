import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Channel, ChannelTokenCreated } from "@webhook-broadcast/contract";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { FakeDeliveryQueue } from "./fakeDeliveryQueue.js";
import { startTestDb, type TestDb } from "./testDb.js";

const OPERATOR_API_KEY = "test-operator-key";
const COOKIE_NAME = "wb_operator";

describe("Channel ingest tokens (admin HTTP seam)", () => {
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

  it("mints a token returning the plaintext once, and lists only id/prefix/createdAt afterwards", async () => {
    const channel = await createChannel("orders");

    const mintResponse = await fetch(
      `${baseUrl}/channels/${channel.id}/tokens`,
      authed({ method: "POST" }),
    );
    expect(mintResponse.status).toBe(201);
    const minted = (await mintResponse.json()) as ChannelTokenCreated;
    expect(minted.id).toEqual(expect.any(String));
    expect(minted.token).toEqual(expect.any(String));
    expect(minted.token.length).toBeGreaterThan(20);
    expect(minted.createdAt).toEqual(expect.any(String));

    const getResponse = await fetch(`${baseUrl}/channels/${channel.id}`, authed());
    const withToken = (await getResponse.json()) as Channel;
    expect(withToken.tokens).toHaveLength(1);
    expect(withToken.tokens[0]).toMatchObject({ id: minted.id, createdAt: minted.createdAt });
    expect(withToken.tokens[0]?.prefix).toEqual(expect.any(String));
    // The listed summary never carries the plaintext secret.
    expect(withToken.tokens[0]).not.toHaveProperty("token");
    expect(minted.token.startsWith(withToken.tokens[0]?.prefix ?? "\0")).toBe(true);
  });

  it("mints distinct tokens with distinct hashes on repeated calls", async () => {
    const channel = await createChannel("orders");

    const first = (await (
      await fetch(`${baseUrl}/channels/${channel.id}/tokens`, authed({ method: "POST" }))
    ).json()) as ChannelTokenCreated;
    const second = (await (
      await fetch(`${baseUrl}/channels/${channel.id}/tokens`, authed({ method: "POST" }))
    ).json()) as ChannelTokenCreated;

    expect(first.token).not.toEqual(second.token);

    const channelResponse = await fetch(`${baseUrl}/channels/${channel.id}`, authed());
    const withTokens = (await channelResponse.json()) as Channel;
    expect(withTokens.tokens).toHaveLength(2);
  });

  it("404s minting a token for an unknown Channel", async () => {
    const response = await fetch(
      `${baseUrl}/channels/00000000-0000-0000-0000-000000000000/tokens`,
      authed({ method: "POST" }),
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "not_found" } });
  });

  it("revokes a token, removing it from the Channel's token list", async () => {
    const channel = await createChannel("orders");
    const minted = (await (
      await fetch(`${baseUrl}/channels/${channel.id}/tokens`, authed({ method: "POST" }))
    ).json()) as ChannelTokenCreated;

    const revokeResponse = await fetch(
      `${baseUrl}/channels/${channel.id}/tokens/${minted.id}`,
      authed({ method: "DELETE" }),
    );
    expect(revokeResponse.status).toBe(204);

    const channelResponse = await fetch(`${baseUrl}/channels/${channel.id}`, authed());
    const withoutToken = (await channelResponse.json()) as Channel;
    expect(withoutToken.tokens).toHaveLength(0);
  });

  it("404s revoking an unknown token id", async () => {
    const channel = await createChannel("orders");
    const response = await fetch(
      `${baseUrl}/channels/${channel.id}/tokens/00000000-0000-0000-0000-000000000000`,
      authed({ method: "DELETE" }),
    );
    expect(response.status).toBe(404);
  });

  it("requires operator auth to mint or revoke", async () => {
    const channel = await createChannel("orders");
    const mintResponse = await fetch(`${baseUrl}/channels/${channel.id}/tokens`, {
      method: "POST",
    });
    expect(mintResponse.status).toBe(401);

    const revokeResponse = await fetch(
      `${baseUrl}/channels/${channel.id}/tokens/00000000-0000-0000-0000-000000000000`,
      { method: "DELETE" },
    );
    expect(revokeResponse.status).toBe(401);
  });
});
