import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { BullMqDeliveryQueue } from "../src/deliveryQueue.js";
import { checkReadiness } from "../src/readiness.js";
import { startTestDb, type TestDb } from "./testDb.js";

const OPERATOR_API_KEY = "test-operator-key";
const COOKIE_NAME = "wb_operator";

async function listen(
  app: ReturnType<typeof createApp>,
): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(app.callback());
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

describe("GET /ready with live Postgres and Redis", () => {
  let testDb: TestDb;
  let redis: StartedRedisContainer;
  let queue: BullMqDeliveryQueue;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    testDb = await startTestDb();
    redis = await new RedisContainer("redis:7-alpine").start();
    queue = new BullMqDeliveryQueue(redis.getConnectionUrl());
    const app = createApp({
      db: testDb.db,
      pool: testDb.pool,
      deliveryQueue: queue,
      operatorApiKey: OPERATOR_API_KEY,
      cookieName: COOKIE_NAME,
    });
    ({ server, baseUrl } = await listen(app));
  }, 120_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await queue.close();
    await redis.stop();
    await testDb.stop();
  }, 30_000);

  it("returns 200 with postgres and redis ok when dependencies are reachable", async () => {
    const response = await fetch(`${baseUrl}/ready`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      checks: { postgres: "ok", redis: "ok" },
    });
  });
});

describe("GET /ready failure paths", () => {
  let server: Server;
  let baseUrl: string;

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("returns 503 when postgres is unreachable", async () => {
    const app = createApp({
      db: {} as never,
      deliveryQueue: {
        enqueue: async () => undefined,
        enqueueBulk: async () => undefined,
        ping: async () => undefined,
      },
      operatorApiKey: OPERATOR_API_KEY,
      cookieName: COOKIE_NAME,
      readinessCheck: async () => ({ postgres: "fail", redis: "ok" }),
    });
    ({ server, baseUrl } = await listen(app));

    const response = await fetch(`${baseUrl}/ready`);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "not_ready",
      checks: { postgres: "fail", redis: "ok" },
    });
  });

  it("returns 503 when redis is unreachable", async () => {
    const app = createApp({
      db: {} as never,
      deliveryQueue: {
        enqueue: async () => undefined,
        enqueueBulk: async () => undefined,
        ping: async () => {
          throw new Error("redis down");
        },
      },
      operatorApiKey: OPERATOR_API_KEY,
      cookieName: COOKIE_NAME,
      readinessCheck: async () => ({ postgres: "ok", redis: "fail" }),
    });
    ({ server, baseUrl } = await listen(app));

    const response = await fetch(`${baseUrl}/ready`);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "not_ready",
      checks: { postgres: "ok", redis: "fail" },
    });
  });

  it("returns 503 when readiness dependencies are not wired", async () => {
    const app = createApp({
      db: {} as never,
      deliveryQueue: {
        enqueue: async () => undefined,
        enqueueBulk: async () => undefined,
        ping: async () => undefined,
      },
      operatorApiKey: OPERATOR_API_KEY,
      cookieName: COOKIE_NAME,
    });
    ({ server, baseUrl } = await listen(app));

    const response = await fetch(`${baseUrl}/ready`);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "not_ready",
      checks: { postgres: "fail", redis: "fail" },
    });
  });
});

describe("checkReadiness", () => {
  it("marks postgres fail when SELECT 1 throws", async () => {
    const checks = await checkReadiness({
      pool: {
        query: async () => {
          throw new Error("postgres down");
        },
      } as never,
      deliveryQueue: {
        enqueue: async () => undefined,
        enqueueBulk: async () => undefined,
        ping: async () => undefined,
      },
    });
    expect(checks).toEqual({ postgres: "fail", redis: "ok" });
  });

  it("marks redis fail when ping throws", async () => {
    const checks = await checkReadiness({
      pool: { query: async () => ({ rows: [{ "?column?": 1 }] }) } as never,
      deliveryQueue: {
        enqueue: async () => undefined,
        enqueueBulk: async () => undefined,
        ping: async () => {
          throw new Error("redis down");
        },
      },
    });
    expect(checks).toEqual({ postgres: "ok", redis: "fail" });
  });
});
