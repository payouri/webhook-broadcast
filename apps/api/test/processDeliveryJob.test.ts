import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import * as dbModule from "@webhook-broadcast/db";
import {
  createDeliveriesForBroadcast,
  getDeliveryForProcessing,
  getEndpointById,
  insertBroadcast,
  insertChannel,
  insertEndpoint,
  schema,
} from "@webhook-broadcast/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
    forwardHeaders?: string[];
    broadcastHeaders?: Record<string, string | string[]>;
  }): Promise<{ deliveryId: string; endpointId: string; channelId: string }> {
    const now = new Date();
    const channel = await insertChannel(testDb.db, {
      id: randomUUID(),
      slug: `channel-${randomUUID()}`,
      description: null,
      enabled: true,
      forwardHeaders: input.forwardHeaders ?? [],
      allowUnauthenticatedIngest: false,
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
      headers: input.broadcastHeaders ?? {},
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
    return { deliveryId: delivery.id, endpointId: endpoint.id, channelId: channel.id };
  }

  async function seedAnotherDelivery(input: {
    channelId: string;
    endpointId: string;
    now: Date;
  }): Promise<string> {
    const broadcast = await insertBroadcast(testDb.db, {
      id: randomUUID(),
      channelId: input.channelId,
      receivedAt: input.now,
      contentType: "application/json",
      body: Buffer.from(JSON.stringify({ again: true })),
      headers: {},
    });
    const [delivery] = await createDeliveriesForBroadcast(testDb.db, {
      broadcastId: broadcast.id,
      channelId: input.channelId,
      endpointIds: [input.endpointId],
      now: input.now,
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
    const { deliveryId } = await seedDelivery({ endpointUrl: stubUrl });

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
    const { deliveryId } = await seedDelivery({ endpointUrl: stubUrl });

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
    const { deliveryId } = await seedDelivery({ endpointUrl: stubUrl });
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
    const { deliveryId } = await seedDelivery({ endpointUrl: stubUrl });
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
    const { deliveryId } = await seedDelivery({ endpointUrl: stubUrl, timeoutMs: 50 });
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
    const { deliveryId } = await seedDelivery({ endpointUrl: "http://127.0.0.1:1" });
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
    const { deliveryId } = await seedDelivery({ endpointUrl: stubUrl });
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
    const { deliveryId } = await seedDelivery({ endpointUrl: stubUrl });
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

  it("is a no-op when the Delivery is terminal (idempotency guard)", async () => {
    handler = (_req, res) => {
      res.writeHead(200);
      res.end();
    };
    const { deliveryId } = await seedDelivery({ endpointUrl: stubUrl });
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

  it("resumes a stale in_progress Delivery on BullMQ redelivery", async () => {
    handler = (_req, res) => {
      res.writeHead(200);
      res.end("ok");
    };
    const { deliveryId } = await seedDelivery({ endpointUrl: stubUrl });
    await testDb.db
      .update(schema.deliveries)
      .set({ status: "in_progress" })
      .where(eq(schema.deliveries.id, deliveryId));

    await processDeliveryJob(baseDeps(), deliveryId);

    const record = await getDeliveryForProcessing(testDb.db, deliveryId);
    expect(record?.status).toBe("succeeded");
    expect(record?.attemptCount).toBe(1);
  });

  it("preserves the Broadcast content-type over Endpoint header overrides", async () => {
    let seenContentType: string | undefined;
    handler = (req, res) => {
      seenContentType = req.headers["content-type"];
      res.writeHead(200);
      res.end("ok");
    };
    const { deliveryId } = await seedDelivery({
      endpointUrl: stubUrl,
      headers: { "content-type": "text/plain" },
    });

    await processDeliveryJob(baseDeps(), deliveryId);

    expect(seenContentType).toBe("application/json");
    const record = await getDeliveryForProcessing(testDb.db, deliveryId);
    expect(record?.status).toBe("succeeded");
  });

  it("forwards only the Channel's allow-listed inbound headers (issue #37)", async () => {
    let seenHeaders: Record<string, string | undefined> = {};
    handler = (req, res) => {
      seenHeaders = { ...req.headers } as Record<string, string | undefined>;
      res.writeHead(200);
      res.end("ok");
    };
    const { deliveryId } = await seedDelivery({
      endpointUrl: stubUrl,
      forwardHeaders: ["x-signature"],
      broadcastHeaders: { "x-signature": "abc123", "x-other": "should-not-forward" },
    });

    await processDeliveryJob(baseDeps(), deliveryId);

    expect(seenHeaders["x-signature"]).toBe("abc123");
    expect(seenHeaders["x-other"]).toBeUndefined();
  });

  it("forwards nothing when the Channel's forwardHeaders allow-list is empty (default, unchanged)", async () => {
    let seenHeaders: Record<string, string | undefined> = {};
    handler = (req, res) => {
      seenHeaders = { ...req.headers } as Record<string, string | undefined>;
      res.writeHead(200);
      res.end("ok");
    };
    const { deliveryId } = await seedDelivery({
      endpointUrl: stubUrl,
      broadcastHeaders: { "x-signature": "abc123" },
    });

    await processDeliveryJob(baseDeps(), deliveryId);

    expect(seenHeaders["x-signature"]).toBeUndefined();
  });

  it("lets an explicit Endpoint header win over a forwarded inbound header of the same name", async () => {
    let seenHeaders: Record<string, string | undefined> = {};
    handler = (req, res) => {
      seenHeaders = { ...req.headers } as Record<string, string | undefined>;
      res.writeHead(200);
      res.end("ok");
    };
    const { deliveryId } = await seedDelivery({
      endpointUrl: stubUrl,
      headers: { "x-signature": "operator-configured" },
      forwardHeaders: ["x-signature"],
      broadcastHeaders: { "x-signature": "attacker-influenced" },
    });

    await processDeliveryJob(baseDeps(), deliveryId);

    expect(seenHeaders["x-signature"]).toBe("operator-configured");
  });

  it("never forwards the Channel's own ingest authorization header even if allow-listed", async () => {
    let seenHeaders: Record<string, string | undefined> = {};
    handler = (req, res) => {
      seenHeaders = { ...req.headers } as Record<string, string | undefined>;
      res.writeHead(200);
      res.end("ok");
    };
    const { deliveryId } = await seedDelivery({
      endpointUrl: stubUrl,
      // Bypasses the contract-level rejection to exercise the worker's own
      // backstop, in case a Channel row ever carries this some other way.
      forwardHeaders: ["authorization"],
      broadcastHeaders: { authorization: "Bearer channel-ingest-token" },
    });

    await processDeliveryJob(baseDeps(), deliveryId);

    expect(seenHeaders.authorization).toBeUndefined();
  });

  it("uses redirect manual on outbound fetch (SSRF hardening)", async () => {
    let seenRedirect: RequestInit["redirect"];
    const fetchImpl: typeof fetch = async (_url, init) => {
      seenRedirect = init?.redirect;
      return new Response("ok", { status: 200 });
    };
    const { deliveryId } = await seedDelivery({ endpointUrl: "http://127.0.0.1:9" });

    await processDeliveryJob(baseDeps({ fetchImpl }), deliveryId);

    expect(seenRedirect).toBe("manual");
  });

  it("releases a stuck in_progress Delivery when completeDelivery fails", async () => {
    handler = (_req, res) => {
      res.writeHead(200);
      res.end("ok");
    };
    const { deliveryId } = await seedDelivery({ endpointUrl: stubUrl });
    const completeSpy = vi
      .spyOn(dbModule, "completeDelivery")
      .mockRejectedValueOnce(new Error("simulated db outage"));

    await expect(processDeliveryJob(baseDeps(), deliveryId)).rejects.toThrow(
      RetryableDeliveryError,
    );

    let record = await getDeliveryForProcessing(testDb.db, deliveryId);
    expect(record?.status).toBe("pending");

    completeSpy.mockRestore();
    await processDeliveryJob(baseDeps(), deliveryId);
    record = await getDeliveryForProcessing(testDb.db, deliveryId);
    expect(record?.status).toBe("succeeded");
  });

  it("auto-disables an Endpoint after a continuous failure streak exceeds the window", async () => {
    handler = (_req, res) => {
      res.writeHead(404);
      res.end("not found");
    };

    const t0 = Date.parse("2026-01-01T00:00:00.000Z");
    let currentMs = t0;
    const now = () => new Date(currentMs);

    const {
      deliveryId: firstDeliveryId,
      endpointId,
      channelId,
    } = await seedDelivery({
      endpointUrl: stubUrl,
    });
    await processDeliveryJob(baseDeps({ endpointAutoDisableAfterMs: 1_000, now }), firstDeliveryId);

    currentMs = t0 + 2_000;
    const secondDeliveryId = await seedAnotherDelivery({
      channelId,
      endpointId,
      now: new Date(currentMs),
    });
    await processDeliveryJob(
      baseDeps({ endpointAutoDisableAfterMs: 1_000, now }),
      secondDeliveryId,
    );

    const endpoint = await getEndpointById(testDb.db, channelId, endpointId);
    expect(endpoint).toMatchObject({
      enabled: false,
    });
    expect(endpoint?.autoDisabledAt).toEqual(new Date(currentMs));
  });

  it("does not auto-disable when a success breaks the failure streak", async () => {
    let call = 0;
    handler = (_req, res) => {
      call += 1;
      if (call === 1) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200);
      res.end("ok");
    };

    const t0 = Date.parse("2026-01-01T00:00:00.000Z");
    let currentMs = t0;
    const now = () => new Date(currentMs);

    const {
      deliveryId: firstDeliveryId,
      endpointId,
      channelId,
    } = await seedDelivery({
      endpointUrl: stubUrl,
    });
    await processDeliveryJob(baseDeps({ endpointAutoDisableAfterMs: 1_000, now }), firstDeliveryId);

    currentMs = t0 + 2_000;
    const secondDeliveryId = await seedAnotherDelivery({
      channelId,
      endpointId,
      now: new Date(currentMs),
    });
    await processDeliveryJob(
      baseDeps({ endpointAutoDisableAfterMs: 1_000, now }),
      secondDeliveryId,
    );

    const endpoint = await getEndpointById(testDb.db, channelId, endpointId);
    expect(endpoint).toMatchObject({ enabled: true, autoDisabledAt: null });
  });
});
