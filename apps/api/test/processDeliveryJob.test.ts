import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import {
  createDeliveriesForBroadcast,
  getDeliveryForProcessing,
  insertBroadcast,
  insertChannel,
  insertEndpoint,
  schema,
} from "@webhook-broadcast/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { RetryableDeliveryError } from "../src/worker/errors.js";
import { processDeliveryJob, type ProcessDeliveryDeps } from "../src/worker/processDeliveryJob.js";
import { startTestDb, type TestDb } from "./testDb.js";

type StubHandler = (req: IncomingMessage, res: ServerResponse) => void;

/**
 * Stub HTTP target (issue #19's AC): a bare `node:http` server whose
 * behavior is swapped per test — the process boundary under test is
 * "worker dials an Endpoint URL", not any particular downstream service.
 *
 * ADR 0003's retry policy is driven entirely by `processDeliveryJob`'s
 * return value — resolving after resetting the Delivery to `pending` and
 * throwing `RetryableDeliveryError`, or exhausting attempts and resolving
 * with `dead_lettered` — so these tests simulate BullMQ's backoff by
 * calling it again directly, with no real waiting involved.
 */
describe("processDeliveryJob (worker HTTP seam, stub target)", () => {
  let testDb: TestDb;
  let stub: Server;
  let stubUrl: string;
  let handler: StubHandler = (_req, res) => {
    res.writeHead(200);
    res.end();
  };

  beforeAll(async () => {
    testDb = await startTestDb();
    stub = createServer((req, res) => handler(req, res));
    await new Promise<void>((resolve) => stub.listen(0, resolve));
    const { port } = stub.address() as AddressInfo;
    stubUrl = `http://127.0.0.1:${port}`;
  }, 60_000);

  afterEach(async () => {
    await testDb.reset();
    handler = (_req, res) => {
      res.writeHead(200);
      res.end();
    };
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => stub.close(() => resolve()));
    await testDb.stop();
  }, 30_000);

  async function seedDelivery(input: {
    endpointUrl: string;
    timeoutMs?: number | null;
    headers?: Record<string, string>;
  }): Promise<string> {
    const now = new Date();
    const channel = await insertChannel(testDb.db, {
      id: randomUUID(),
      slug: `channel-${randomUUID()}`,
      description: null,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    const endpoint = await insertEndpoint(testDb.db, {
      id: randomUUID(),
      channelId: channel.id,
      name: null,
      url: input.endpointUrl,
      timeoutMs: input.timeoutMs ?? null,
      headers: input.headers ?? {},
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    const broadcast = await insertBroadcast(testDb.db, {
      id: randomUUID(),
      channelId: channel.id,
      receivedAt: now,
      contentType: "application/json",
      body: Buffer.from(JSON.stringify({ hello: "world" })),
      headers: {},
    });
    const [delivery] = await createDeliveriesForBroadcast(testDb.db, {
      broadcastId: broadcast.id,
      channelId: channel.id,
      endpointIds: [endpoint.id],
      now,
    });
    if (!delivery) {
      throw new Error("expected a Delivery row");
    }
    return delivery.id;
  }

  async function attemptRowsFor(deliveryId: string) {
    return testDb.db
      .select()
      .from(schema.attempts)
      .where(eq(schema.attempts.deliveryId, deliveryId));
  }

  const baseDeps = (overrides: Partial<ProcessDeliveryDeps> = {}): ProcessDeliveryDeps => ({
    db: testDb.db,
    defaultTimeoutMs: 2_000,
    ...overrides,
  });

  it("marks the Delivery succeeded and records a 2xx Attempt", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    };
    const deliveryId = await seedDelivery({ endpointUrl: stubUrl });

    await processDeliveryJob(baseDeps(), deliveryId);

    const record = await getDeliveryForProcessing(testDb.db, deliveryId);
    expect(record?.status).toBe("succeeded");
    expect(record?.attemptCount).toBe(1);

    const attemptRows = await attemptRowsFor(deliveryId);
    expect(attemptRows).toHaveLength(1);
    expect(attemptRows[0]).toMatchObject({ n: 1, statusCode: 200, error: null });
    expect(attemptRows[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("marks the Delivery failed immediately on a non-retryable 4xx response, with no retry", async () => {
    handler = (_req, res) => {
      res.writeHead(404);
      res.end("not found");
    };
    const deliveryId = await seedDelivery({ endpointUrl: stubUrl });

    await processDeliveryJob(baseDeps(), deliveryId);

    const record = await getDeliveryForProcessing(testDb.db, deliveryId);
    expect(record?.status).toBe("failed");
    expect(record?.attemptCount).toBe(1);

    const attemptRows = await attemptRowsFor(deliveryId);
    expect(attemptRows).toHaveLength(1);
    expect(attemptRows[0]).toMatchObject({ n: 1, statusCode: 404, error: null });
  });

  it("retries a 5xx failure and dead-letters once DELIVERY_MAX_ATTEMPTS is exhausted", async () => {
    handler = (_req, res) => {
      res.writeHead(500);
      res.end("boom");
    };
    const deliveryId = await seedDelivery({ endpointUrl: stubUrl });
    const deps = baseDeps({ maxAttempts: 3, backoffBaseMs: 1, backoffMaxMs: 10 });

    await expect(processDeliveryJob(deps, deliveryId)).rejects.toThrow(RetryableDeliveryError);
    let record = await getDeliveryForProcessing(testDb.db, deliveryId);
    expect(record?.status).toBe("pending");
    expect(record?.attemptCount).toBe(1);

    await expect(processDeliveryJob(deps, deliveryId)).rejects.toThrow(RetryableDeliveryError);
    record = await getDeliveryForProcessing(testDb.db, deliveryId);
    expect(record?.status).toBe("pending");
    expect(record?.attemptCount).toBe(2);

    // Third and final attempt exhausts DELIVERY_MAX_ATTEMPTS — no more throw.
    await processDeliveryJob(deps, deliveryId);
    record = await getDeliveryForProcessing(testDb.db, deliveryId);
    expect(record?.status).toBe("dead_lettered");
    expect(record?.attemptCount).toBe(3);

    const attemptRows = await attemptRowsFor(deliveryId);
    expect(attemptRows.map((row) => row.n).sort()).toEqual([1, 2, 3]);
    expect(attemptRows.every((row) => row.statusCode === 500)).toBe(true);
  });

  it("recovers if a retry attempt succeeds before attempts are exhausted", async () => {
    handler = (_req, res) => {
      res.writeHead(503);
      res.end("try later");
    };
    const deliveryId = await seedDelivery({ endpointUrl: stubUrl });
    const deps = baseDeps({ maxAttempts: 5, backoffBaseMs: 1, backoffMaxMs: 10 });

    await expect(processDeliveryJob(deps, deliveryId)).rejects.toThrow(RetryableDeliveryError);

    handler = (_req, res) => {
      res.writeHead(200);
      res.end("ok");
    };
    await processDeliveryJob(deps, deliveryId);

    const record = await getDeliveryForProcessing(testDb.db, deliveryId);
    expect(record?.status).toBe("succeeded");
    expect(record?.attemptCount).toBe(2);

    const attemptRows = await attemptRowsFor(deliveryId);
    expect(attemptRows).toHaveLength(2);
    expect(attemptRows.find((row) => row.n === 1)).toMatchObject({ statusCode: 503 });
    expect(attemptRows.find((row) => row.n === 2)).toMatchObject({ statusCode: 200 });
  });

  it("retries a timeout (client-side abort) instead of failing immediately", async () => {
    handler = () => {
      // Never respond; the client-side AbortController must fire.
    };
    const deliveryId = await seedDelivery({ endpointUrl: stubUrl, timeoutMs: 50 });
    const deps = baseDeps({ maxAttempts: 1, backoffBaseMs: 1, backoffMaxMs: 10 });

    // maxAttempts: 1 means the very first Attempt is already the last one.
    await processDeliveryJob(deps, deliveryId);

    const record = await getDeliveryForProcessing(testDb.db, deliveryId);
    expect(record?.status).toBe("dead_lettered");

    const attemptRows = await attemptRowsFor(deliveryId);
    expect(attemptRows[0]?.statusCode).toBeNull();
    expect(attemptRows[0]?.error).toContain("timed out");
  });

  it("retries a connection-refused (network error) instead of failing immediately", async () => {
    const deliveryId = await seedDelivery({ endpointUrl: "http://127.0.0.1:1" });
    const deps = baseDeps({ maxAttempts: 2, backoffBaseMs: 1, backoffMaxMs: 10 });

    await expect(processDeliveryJob(deps, deliveryId)).rejects.toThrow(RetryableDeliveryError);
    const record = await getDeliveryForProcessing(testDb.db, deliveryId);
    expect(record?.status).toBe("pending");

    await processDeliveryJob(deps, deliveryId);
    const finalRecord = await getDeliveryForProcessing(testDb.db, deliveryId);
    expect(finalRecord?.status).toBe("dead_lettered");

    const attemptRows = await attemptRowsFor(deliveryId);
    expect(attemptRows).toHaveLength(2);
    expect(attemptRows.every((row) => row.statusCode === null)).toBe(true);
  });

  it("honours Retry-After on a 429 response, capped at the backoff cap", async () => {
    handler = (_req, res) => {
      res.writeHead(429, { "retry-after": "1" });
      res.end("slow down");
    };
    const deliveryId = await seedDelivery({ endpointUrl: stubUrl });
    const deps = baseDeps({ maxAttempts: 2, backoffBaseMs: 5_000, backoffMaxMs: 3_600_000 });

    let caught: unknown;
    try {
      await processDeliveryJob(deps, deliveryId);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RetryableDeliveryError);
    expect((caught as RetryableDeliveryError).delayMs).toBe(1_000);
  });

  it("caps an honoured Retry-After at the backoff cap", async () => {
    handler = (_req, res) => {
      res.writeHead(503, { "retry-after": "3600" });
      res.end("try later");
    };
    const deliveryId = await seedDelivery({ endpointUrl: stubUrl });
    const deps = baseDeps({ maxAttempts: 2, backoffBaseMs: 5_000, backoffMaxMs: 60_000 });

    let caught: unknown;
    try {
      await processDeliveryJob(deps, deliveryId);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RetryableDeliveryError);
    expect((caught as RetryableDeliveryError).delayMs).toBe(60_000);
  });

  it("is a no-op when the Delivery is not pending (idempotency guard)", async () => {
    handler = (_req, res) => {
      res.writeHead(200);
      res.end();
    };
    const deliveryId = await seedDelivery({ endpointUrl: stubUrl });
    await processDeliveryJob(baseDeps(), deliveryId);

    let calls = 0;
    handler = (_req, res) => {
      calls += 1;
      res.writeHead(200);
      res.end();
    };
    await processDeliveryJob(baseDeps(), deliveryId);

    expect(calls).toBe(0);
    const record = await getDeliveryForProcessing(testDb.db, deliveryId);
    expect(record?.attemptCount).toBe(1);
  });
});
