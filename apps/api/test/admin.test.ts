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

        // Issue #91: the operator needs both how long the browser standard
        // way (Retry-After) and the exact epoch the dashboard can count down
        // to, not silence on both.
        const retryAfter = blocked.headers.get("retry-after");
        expect(retryAfter).not.toBeNull();
        expect(Number(retryAfter)).toBeGreaterThan(0);
        expect(Number(retryAfter)).toBeLessThanOrEqual(60);

        const blockedBody = (await blocked.json()) as {
          error: { code: string };
          resetAt: number;
        };
        expect(blockedBody.error.code).toBe("rate_limited");
        expect(blockedBody.resetAt).toBeGreaterThan(Date.now());
        expect(blockedBody.resetAt).toBeLessThanOrEqual(Date.now() + 60_000);
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
        allowUnauthenticatedIngest: false,
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

    it("filters the list by exact slug, and finds nothing for an unknown slug", async () => {
      await fetch(
        `${baseUrl}/channels`,
        authed({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug: "orders" }),
        }),
      );
      await fetch(
        `${baseUrl}/channels`,
        authed({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug: "invoices" }),
        }),
      );

      const response = await fetch(`${baseUrl}/channels?slug=orders`, authed());
      expect(response.status).toBe(200);
      const list = (await response.json()) as ChannelList;
      expect(list.items).toHaveLength(1);
      expect(list.items[0]).toMatchObject({ slug: "orders" });
      expect(list.nextCursor).toBeNull();

      const missResponse = await fetch(`${baseUrl}/channels?slug=unknown-slug`, authed());
      expect(missResponse.status).toBe(200);
      await expect(missResponse.json()).resolves.toMatchObject({ items: [], nextCursor: null });
    });

    it("creates a Channel with a forwardHeaders allow-list and lets it be forwarded/updated (issue #37)", async () => {
      const createResponse = await fetch(
        `${baseUrl}/channels`,
        authed({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug: "acme", forwardHeaders: ["x-signature"] }),
        }),
      );
      expect(createResponse.status).toBe(201);
      const created = (await createResponse.json()) as Channel;
      expect(created.forwardHeaders).toEqual(["x-signature"]);

      const listResponse = await fetch(`${baseUrl}/channels`, authed());
      const list = (await listResponse.json()) as ChannelList;
      expect(list.items.find((item) => item.id === created.id)).toMatchObject({
        forwardHeaders: ["x-signature"],
      });

      const patchResponse = await fetch(
        `${baseUrl}/channels/${created.id}`,
        authed({
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ forwardHeaders: ["x-signature", "x-request-id"] }),
        }),
      );
      expect(patchResponse.status).toBe(200);
      await expect(patchResponse.json()).resolves.toMatchObject({
        forwardHeaders: ["x-signature", "x-request-id"],
      });
    });

    it("defaults a new Channel's forwardHeaders to empty (unchanged behaviour)", async () => {
      const response = await fetch(
        `${baseUrl}/channels`,
        authed({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug: "plain" }),
        }),
      );
      const created = (await response.json()) as Channel;
      expect(created.forwardHeaders).toEqual([]);
    });

    it("rejects forwarding the ingest authorization header even if explicitly named (issue #37)", async () => {
      const response = await fetch(
        `${baseUrl}/channels`,
        authed({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug: "no-auth-forward", forwardHeaders: ["Authorization"] }),
        }),
      );
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "validation_failed" },
      });
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

    it("allows reusing a slug after soft-deleting the original Channel (issue #35)", async () => {
      const createResponse = await fetch(
        `${baseUrl}/channels`,
        authed({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug: "reusable" }),
        }),
      );
      expect(createResponse.status).toBe(201);
      const created = (await createResponse.json()) as Channel;

      const deleteResponse = await fetch(
        `${baseUrl}/channels/${created.id}`,
        authed({ method: "DELETE" }),
      );
      expect(deleteResponse.status).toBe(204);

      const recreateResponse = await fetch(
        `${baseUrl}/channels`,
        authed({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug: "reusable" }),
        }),
      );
      expect(recreateResponse.status).toBe(201);
      const recreated = (await recreateResponse.json()) as Channel;
      expect(recreated.slug).toBe("reusable");
      expect(recreated.id).not.toBe(created.id);
    });

    it("keeps repeated delete/create cycles legal and still rejects a live duplicate (issue #35)", async () => {
      const createChannel = (): Promise<Response> =>
        fetch(
          `${baseUrl}/channels`,
          authed({
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ slug: "recycled" }),
          }),
        );

      // Two full cycles leave two soft-deleted rows sharing the slug; neither
      // is covered by the partial index, so the third create still succeeds.
      const ids: string[] = [];
      for (let cycle = 0; cycle < 2; cycle += 1) {
        const created = await createChannel();
        expect(created.status).toBe(201);
        const { id } = (await created.json()) as Channel;
        ids.push(id);
        const deleted = await fetch(`${baseUrl}/channels/${id}`, authed({ method: "DELETE" }));
        expect(deleted.status).toBe(204);
      }

      const live = await createChannel();
      expect(live.status).toBe(201);
      const liveChannel = (await live.json()) as Channel;
      expect(ids).not.toContain(liveChannel.id);

      // Uniqueness is scoped, not removed: a second *live* row still conflicts
      // even though dead rows already hold the same slug.
      const duplicate = await createChannel();
      expect(duplicate.status).toBe(409);
      await expect(duplicate.json()).resolves.toMatchObject({ error: { code: "conflict" } });

      // Only the live Channel is visible.
      const listResponse = await fetch(`${baseUrl}/channels?slug=recycled`, authed());
      expect(listResponse.status).toBe(200);
      const listed = (await listResponse.json()) as { items: Channel[] };
      expect(listed.items.map((c) => c.id)).toEqual([liveChannel.id]);
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

  // Issue #38: a Channel opts into POST /ingest/:slug accepting no token.
  // The slug then becomes the only gate, so a short/guessable slug is
  // rejected the same way in both create and update.
  describe("unauthenticated-ingest opt-in", () => {
    function authed(init: RequestInit = {}): RequestInit {
      return { ...init, headers: { authorization: `Bearer ${OPERATOR_API_KEY}`, ...init.headers } };
    }
    const LONG_SLUG = "provider-hosted-auth-notify-abc123";

    it("creates a Channel with allowUnauthenticatedIngest: true given a sufficiently long slug", async () => {
      const response = await fetch(
        `${baseUrl}/channels`,
        authed({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug: LONG_SLUG, allowUnauthenticatedIngest: true }),
        }),
      );
      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toMatchObject({
        slug: LONG_SLUG,
        allowUnauthenticatedIngest: true,
      });
    });

    it("rejects creating an open Channel with a short slug", async () => {
      const response = await fetch(
        `${baseUrl}/channels`,
        authed({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug: "short", allowUnauthenticatedIngest: true }),
        }),
      );
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "validation_failed" },
      });
    });

    it("allows a short slug when allowUnauthenticatedIngest stays false", async () => {
      const response = await fetch(
        `${baseUrl}/channels`,
        authed({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug: "short" }),
        }),
      );
      expect(response.status).toBe(201);
    });

    it("rejects enabling open ingest on an existing Channel whose slug is too short", async () => {
      const createResponse = await fetch(
        `${baseUrl}/channels`,
        authed({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug: "short" }),
        }),
      );
      const created = (await createResponse.json()) as Channel;

      const patchResponse = await fetch(
        `${baseUrl}/channels/${created.id}`,
        authed({
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ allowUnauthenticatedIngest: true }),
        }),
      );
      expect(patchResponse.status).toBe(400);
      await expect(patchResponse.json()).resolves.toMatchObject({
        error: { code: "validation_failed" },
      });

      const getResponse = await fetch(`${baseUrl}/channels/${created.id}`, authed());
      await expect(getResponse.json()).resolves.toMatchObject({
        allowUnauthenticatedIngest: false,
      });
    });

    it("allows enabling open ingest while lengthening the slug in the same patch", async () => {
      const createResponse = await fetch(
        `${baseUrl}/channels`,
        authed({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug: "short" }),
        }),
      );
      const created = (await createResponse.json()) as Channel;

      const patchResponse = await fetch(
        `${baseUrl}/channels/${created.id}`,
        authed({
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug: LONG_SLUG, allowUnauthenticatedIngest: true }),
        }),
      );
      expect(patchResponse.status).toBe(200);
      await expect(patchResponse.json()).resolves.toMatchObject({
        slug: LONG_SLUG,
        allowUnauthenticatedIngest: true,
      });
    });
  });

  // Issue #99: the per-Channel override of the accepted-ingest status. Unset
  // means inherit the service-wide default, so an operator that never touches
  // this field keeps today's behaviour; the value is constrained to 2xx
  // because a non-2xx "success" would make every well-behaved producer retry
  // an event that was already accepted.
  describe("Channel ingestSuccessStatus", () => {
    function authed(init: RequestInit = {}): RequestInit {
      return { ...init, headers: { authorization: `Bearer ${OPERATOR_API_KEY}`, ...init.headers } };
    }

    async function createChannel(body: Record<string, unknown>): Promise<Response> {
      return fetch(
        `${baseUrl}/channels`,
        authed({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    }

    it("defaults to null (inherit) when the field is omitted", async () => {
      const response = await createChannel({ slug: "orders" });
      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toMatchObject({ ingestSuccessStatus: null });
    });

    it("creates a Channel with an explicit 2xx override and reads it back", async () => {
      const response = await createChannel({ slug: "orders", ingestSuccessStatus: 200 });
      expect(response.status).toBe(201);
      const created = (await response.json()) as Channel;
      expect(created.ingestSuccessStatus).toBe(200);

      const getResponse = await fetch(`${baseUrl}/channels/${created.id}`, authed());
      await expect(getResponse.json()).resolves.toMatchObject({ ingestSuccessStatus: 200 });
    });

    it("patches the override and clears it back to inherit with null", async () => {
      const created = (await (await createChannel({ slug: "orders" })).json()) as Channel;

      const patchResponse = await fetch(
        `${baseUrl}/channels/${created.id}`,
        authed({
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ingestSuccessStatus: 204 }),
        }),
      );
      expect(patchResponse.status).toBe(200);
      await expect(patchResponse.json()).resolves.toMatchObject({ ingestSuccessStatus: 204 });

      const clearResponse = await fetch(
        `${baseUrl}/channels/${created.id}`,
        authed({
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ingestSuccessStatus: null }),
        }),
      );
      expect(clearResponse.status).toBe(200);
      await expect(clearResponse.json()).resolves.toMatchObject({ ingestSuccessStatus: null });
    });

    it.each([199, 300, 404, 500])("rejects a non-2xx status (%i) on create", async (status) => {
      const response = await createChannel({ slug: "orders", ingestSuccessStatus: status });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "validation_failed" },
      });
    });

    it("rejects a non-2xx status on patch and leaves the stored value untouched", async () => {
      const created = (await (
        await createChannel({ slug: "orders", ingestSuccessStatus: 200 })
      ).json()) as Channel;

      const patchResponse = await fetch(
        `${baseUrl}/channels/${created.id}`,
        authed({
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ingestSuccessStatus: 500 }),
        }),
      );
      expect(patchResponse.status).toBe(400);

      const getResponse = await fetch(`${baseUrl}/channels/${created.id}`, authed());
      await expect(getResponse.json()).resolves.toMatchObject({ ingestSuccessStatus: 200 });
    });
  });
});
