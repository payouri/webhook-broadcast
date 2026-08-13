import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { OperatorTokenCreated, OperatorTokenList } from "@webhook-broadcast/contract";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { FakeDeliveryQueue } from "./fakeDeliveryQueue.js";
import { startTestDb, type TestDb } from "./testDb.js";

const OPERATOR_API_KEY = "test-operator-key";
const COOKIE_NAME = "wb_operator";

describe("Operator tokens (issue #41 — multiple valid credentials)", () => {
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

  async function mintOperatorToken(label: string): Promise<OperatorTokenCreated> {
    const response = await fetch(
      `${baseUrl}/operator-tokens`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label }),
      }),
    );
    expect(response.status).toBe(201);
    return (await response.json()) as OperatorTokenCreated;
  }

  it("mints a token returning the plaintext once, listing only id/label/prefix/createdAt/lastUsedAt afterwards", async () => {
    const minted = await mintOperatorToken("ci-nonprod");
    expect(minted.id).toEqual(expect.any(String));
    expect(minted.token).toEqual(expect.any(String));
    expect(minted.token.length).toBeGreaterThan(20);
    expect(minted.label).toBe("ci-nonprod");

    const listResponse = await fetch(`${baseUrl}/operator-tokens`, authed());
    expect(listResponse.status).toBe(200);
    const list = (await listResponse.json()) as OperatorTokenList;
    expect(list.items).toHaveLength(1);
    expect(list.nextCursor).toBeNull();
    expect(list.items[0]).toMatchObject({ id: minted.id, label: "ci-nonprod", lastUsedAt: null });
    expect(list.items[0]).not.toHaveProperty("token");
    expect(minted.token.startsWith(list.items[0]?.prefix ?? "\0")).toBe(true);
  });

  it("accepts a minted operator token as a Bearer credential with full admin privilege", async () => {
    const minted = await mintOperatorToken("laptop-alex");

    const response = await fetch(`${baseUrl}/channels`, {
      headers: { authorization: `Bearer ${minted.token}` },
    });
    expect(response.status).toBe(200);
  });

  it("records lastUsedAt after a minted token authenticates a request", async () => {
    const minted = await mintOperatorToken("laptop-alex");

    await fetch(`${baseUrl}/channels`, {
      headers: { authorization: `Bearer ${minted.token}` },
    });

    // lastUsedAt is written fire-and-forget; poll briefly for it to land.
    let lastUsedAt: string | null = null;
    for (let attempt = 0; attempt < 20 && lastUsedAt === null; attempt += 1) {
      const listResponse = await fetch(`${baseUrl}/operator-tokens`, authed());
      const list = (await listResponse.json()) as OperatorTokenList;
      lastUsedAt = list.items.find((item) => item.id === minted.id)?.lastUsedAt ?? null;
      if (lastUsedAt === null) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    expect(lastUsedAt).not.toBeNull();
  });

  it("revokes a token immediately: it stops authenticating and disappears from the list", async () => {
    const minted = await mintOperatorToken("laptop-alex");

    const revokeResponse = await fetch(
      `${baseUrl}/operator-tokens/${minted.id}`,
      authed({ method: "DELETE" }),
    );
    expect(revokeResponse.status).toBe(204);

    const usedAfterRevoke = await fetch(`${baseUrl}/channels`, {
      headers: { authorization: `Bearer ${minted.token}` },
    });
    expect(usedAfterRevoke.status).toBe(401);

    const listResponse = await fetch(`${baseUrl}/operator-tokens`, authed());
    const list = (await listResponse.json()) as OperatorTokenList;
    expect(list.items).toHaveLength(0);
  });

  it("revoking one token leaves other tokens and the bootstrap key valid", async () => {
    const first = await mintOperatorToken("laptop-alex");
    const second = await mintOperatorToken("ci-nonprod");

    await fetch(`${baseUrl}/operator-tokens/${first.id}`, authed({ method: "DELETE" }));

    const secondStillWorks = await fetch(`${baseUrl}/channels`, {
      headers: { authorization: `Bearer ${second.token}` },
    });
    expect(secondStillWorks.status).toBe(200);

    const bootstrapStillWorks = await fetch(`${baseUrl}/channels`, authed());
    expect(bootstrapStillWorks.status).toBe(200);
  });

  it("404s revoking an unknown token id", async () => {
    const response = await fetch(
      `${baseUrl}/operator-tokens/00000000-0000-0000-0000-000000000000`,
      authed({ method: "DELETE" }),
    );
    expect(response.status).toBe(404);
  });

  it("400s minting without a label", async () => {
    const response = await fetch(
      `${baseUrl}/operator-tokens`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("requires operator auth to mint, list, or revoke", async () => {
    const mintResponse = await fetch(`${baseUrl}/operator-tokens`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "x" }),
    });
    expect(mintResponse.status).toBe(401);

    const listResponse = await fetch(`${baseUrl}/operator-tokens`);
    expect(listResponse.status).toBe(401);

    const revokeResponse = await fetch(
      `${baseUrl}/operator-tokens/00000000-0000-0000-0000-000000000000`,
      { method: "DELETE" },
    );
    expect(revokeResponse.status).toBe(401);
  });

  it("does not accept a minted operator token for dashboard login", async () => {
    const minted = await mintOperatorToken("laptop-alex");

    const loginResponse = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: minted.token }),
    });
    expect(loginResponse.status).toBe(401);
  });
});
