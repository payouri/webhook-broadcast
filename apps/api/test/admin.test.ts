import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Channel, ChannelList } from "@webhook-broadcast/contract";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { FakeDeliveryQueue } from "./fakeDeliveryQueue.js";
import { startTestDb, type TestDb } from "./testDb.js";

const OPERATOR_API_KEY = "test-operator-key";
const COOKIE_NAME = "wb_operator";

function extractCookiePair(setCookieHeader: string | null): string {
  if (!setCookieHeader) {
    throw new Error("expected a Set-Cookie header");
  }
  return setCookieHeader.split(";")[0] as string;
}

describe("Admin auth + Channel CRUD (HTTP seam)", () => {
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

  describe("operator auth", () => {
    it("rejects a request with no credentials using the shared error envelope", async () => {
      const response = await fetch(`${baseUrl}/channels`);
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        error: { code: "unauthorized", message: expect.any(String) },
      });
    });

    it("rejects an invalid Bearer token", async () => {
      const response = await fetch(`${baseUrl}/channels`, {
        headers: { authorization: "Bearer wrong-key" },
      });
      expect(response.status).toBe(401);
    });

    it("rejects an invalid session cookie", async () => {
      const response = await fetch(`${baseUrl}/channels`, {
        headers: { cookie: `${COOKIE_NAME}=wrong-key` },
      });
      expect(response.status).toBe(401);
    });

    it("accepts a valid Bearer token", async () => {
      const response = await fetch(`${baseUrl}/channels`, {
        headers: { authorization: `Bearer ${OPERATOR_API_KEY}` },
      });
      expect(response.status).toBe(200);
    });

    it("logs in with the operator API key and sets an HttpOnly session cookie usable for auth", async () => {
      const loginResponse = await fetch(`${baseUrl}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: OPERATOR_API_KEY }),
      });
      expect(loginResponse.status).toBe(200);
      const setCookie = loginResponse.headers.get("set-cookie");
      expect(setCookie).toMatch(/HttpOnly/i);
      const cookiePair = extractCookiePair(setCookie);

      const channelsResponse = await fetch(`${baseUrl}/channels`, {
        headers: { cookie: cookiePair },
      });
      expect(channelsResponse.status).toBe(200);
    });

    it("rejects login with the wrong operator API key", async () => {
      const response = await fetch(`${baseUrl}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: "wrong-key" }),
      });
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        error: { code: "unauthorized", message: expect.any(String) },
      });
    });

    it("rate-limits repeated failed login attempts from the same IP", async () => {
      const app = createApp({
        db: testDb.db,
        deliveryQueue: new FakeDeliveryQueue(),
        operatorApiKey: OPERATOR_API_KEY,
        cookieName: COOKIE_NAME,
        loginRateLimitMaxAttempts: 2,
        loginRateLimitWindowMs: 60_000,
      });
      const rateLimitedServer = createServer(app.callback());
      await new Promise<void>((resolve) => rateLimitedServer.listen(0, resolve));
      const { port } = rateLimitedServer.address() as AddressInfo;
      const loginUrl = `http://127.0.0.1:${port}/auth/login`;

      try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const response = await fetch(loginUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ apiKey: "wrong-key" }),
          });
          expect(response.status).toBe(401);
        }

        const blocked = await fetch(loginUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ apiKey: "wrong-key" }),
        });
        expect(blocked.status).toBe(429);
        await expect(blocked.json()).resolves.toMatchObject({
          error: { code: "rate_limited" },
        });
      } finally {
        await new Promise<void>((resolve) => rateLimitedServer.close(() => resolve()));
      }
    });

    it("sets a Secure session cookie when trustProxy sees HTTPS", async () => {
      const app = createApp({
        db: testDb.db,
        deliveryQueue: new FakeDeliveryQueue(),
        operatorApiKey: OPERATOR_API_KEY,
        cookieName: COOKIE_NAME,
        trustProxy: true,
      });
      const secureServer = createServer(app.callback());
      await new Promise<void>((resolve) => secureServer.listen(0, resolve));
      const { port } = secureServer.address() as AddressInfo;

      try {
        const loginResponse = await fetch(`http://127.0.0.1:${port}/auth/login`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-proto": "https",
          },
          body: JSON.stringify({ apiKey: OPERATOR_API_KEY }),
        });
        expect(loginResponse.status).toBe(200);
        expect(loginResponse.headers.get("set-cookie")).toMatch(/Secure/i);
      } finally {
        await new Promise<void>((resolve) => secureServer.close(() => resolve()));
      }
    });

    it("does not trust X-Forwarded-Proto for Secure unless trustProxy is enabled", async () => {
      const loginResponse = await fetch(`${baseUrl}/auth/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-proto": "https",
        },
        body: JSON.stringify({ apiKey: OPERATOR_API_KEY }),
      });
      expect(loginResponse.status).toBe(200);
      expect(loginResponse.headers.get("set-cookie")).not.toMatch(/Secure/i);
    });
  });

  describe("Channel CRUD", () => {
    function authed(init: RequestInit = {}): RequestInit {
      return { ...init, headers: { authorization: `Bearer ${OPERATOR_API_KEY}`, ...init.headers } };
    }

    it("creates, lists, gets, patches, and soft-deletes a Channel", async () => {
      const createResponse = await fetch(
        `${baseUrl}/channels`,
        authed({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug: "orders", description: "Order events" }),
        }),
      );
      expect(createResponse.status).toBe(201);
      const created = (await createResponse.json()) as Channel;
      expect(created).toMatchObject({
        slug: "orders",
        description: "Order events",
        enabled: true,
        endpointCount: 0,
        tokens: [],
        deletedAt: null,
      });
      expect(created.id).toEqual(expect.any(String));

      const listResponse = await fetch(`${baseUrl}/channels`, authed());
      expect(listResponse.status).toBe(200);
      const list = (await listResponse.json()) as ChannelList;
      expect(list.items).toHaveLength(1);
      expect(list.items[0]).toMatchObject({ id: created.id, slug: "orders" });
      expect(list.nextCursor).toBeNull();

      const getResponse = await fetch(`${baseUrl}/channels/${created.id}`, authed());
      expect(getResponse.status).toBe(200);
      await expect(getResponse.json()).resolves.toMatchObject({ id: created.id, slug: "orders" });

      const patchResponse = await fetch(
        `${baseUrl}/channels/${created.id}`,
        authed({
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug: "orders-v2", enabled: false }),
        }),
      );
      expect(patchResponse.status).toBe(200);
      const patched = (await patchResponse.json()) as Channel;
      expect(patched).toMatchObject({ id: created.id, slug: "orders-v2", enabled: false });

      const deleteResponse = await fetch(
        `${baseUrl}/channels/${created.id}`,
        authed({ method: "DELETE" }),
      );
      expect(deleteResponse.status).toBe(204);

      const getAfterDelete = await fetch(`${baseUrl}/channels/${created.id}`, authed());
      expect(getAfterDelete.status).toBe(404);

      const listAfterDelete = await fetch(`${baseUrl}/channels`, authed());
      await expect(listAfterDelete.json()).resolves.toMatchObject({ items: [] });
    });

    it("rejects an invalid slug with a validation_failed envelope", async () => {
      const response = await fetch(
        `${baseUrl}/channels`,
        authed({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug: "Not A Slug" }),
        }),
      );
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "validation_failed" },
      });
    });

    it("rejects creating a Channel with a slug that already exists", async () => {
      await fetch(
        `${baseUrl}/channels`,
        authed({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug: "dup" }),
        }),
      );
      const response = await fetch(
        `${baseUrl}/channels`,
        authed({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug: "dup" }),
        }),
      );
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "conflict" } });
    });

    it("404s for a get/patch/delete on an unknown Channel id", async () => {
      const unknownId = "00000000-0000-0000-0000-000000000000";

      const getResponse = await fetch(`${baseUrl}/channels/${unknownId}`, authed());
      expect(getResponse.status).toBe(404);

      const patchResponse = await fetch(
        `${baseUrl}/channels/${unknownId}`,
        authed({
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: false }),
        }),
      );
      expect(patchResponse.status).toBe(404);

      const deleteResponse = await fetch(
        `${baseUrl}/channels/${unknownId}`,
        authed({ method: "DELETE" }),
      );
      expect(deleteResponse.status).toBe(404);
    });
  });
});
