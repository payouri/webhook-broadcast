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
import { processDeliveryJob } from "../src/worker/processDeliveryJob.js";
import { startTestDb, type TestDb } from "./testDb.js";

type StubHandler = (req: IncomingMessage, res: ServerResponse) => void;

/**
 * Stub HTTP target (issue #19's AC): a bare `node:http` server whose
 * behavior is swapped per test — the process boundary under test is
 * "worker dials an Endpoint URL", not any particular downstream service.
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

  it("marks the Delivery succeeded and records a 2xx Attempt", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    };
    const deliveryId = await seedDelivery({ endpointUrl: stubUrl });

    await processDeliveryJob({ db: testDb.db, defaultTimeoutMs: 2_000 }, deliveryId);

    const record = await getDeliveryForProcessing(testDb.db, deliveryId);
    expect(record?.status).toBe("succeeded");
    expect(record?.attemptCount).toBe(1);

    const attemptRows = await testDb.db
      .select()
      .from(schema.attempts)
      .where(eq(schema.attempts.deliveryId, deliveryId));
    expect(attemptRows).toHaveLength(1);
    expect(attemptRows[0]).toMatchObject({ n: 1, statusCode: 200, error: null });
    expect(attemptRows[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("marks the Delivery failed on a non-2xx response (this slice: no retry)", async () => {
    handler = (_req, res) => {
      res.writeHead(500);
      res.end("boom");
    };
    const deliveryId = await seedDelivery({ endpointUrl: stubUrl });

    await processDeliveryJob({ db: testDb.db, defaultTimeoutMs: 2_000 }, deliveryId);

    const record = await getDeliveryForProcessing(testDb.db, deliveryId);
    expect(record?.status).toBe("failed");

    const attemptRows = await testDb.db
      .select()
      .from(schema.attempts)
      .where(eq(schema.attempts.deliveryId, deliveryId));
    expect(attemptRows[0]).toMatchObject({ n: 1, statusCode: 500, error: null });
  });

  it("marks the Delivery failed with a timeout error when the Endpoint hangs", async () => {
    handler = () => {
      // Never respond; the client-side AbortController must fire.
    };
    const deliveryId = await seedDelivery({ endpointUrl: stubUrl, timeoutMs: 50 });

    await processDeliveryJob({ db: testDb.db, defaultTimeoutMs: 2_000 }, deliveryId);

    const record = await getDeliveryForProcessing(testDb.db, deliveryId);
    expect(record?.status).toBe("failed");

    const attemptRows = await testDb.db
      .select()
      .from(schema.attempts)
      .where(eq(schema.attempts.deliveryId, deliveryId));
    expect(attemptRows[0]?.statusCode).toBeNull();
    expect(attemptRows[0]?.error).toContain("timed out");
  });

  it("marks the Delivery failed when the connection is refused", async () => {
    const deliveryId = await seedDelivery({ endpointUrl: "http://127.0.0.1:1" });

    await processDeliveryJob({ db: testDb.db, defaultTimeoutMs: 2_000 }, deliveryId);

    const record = await getDeliveryForProcessing(testDb.db, deliveryId);
    expect(record?.status).toBe("failed");

    const attemptRows = await testDb.db
      .select()
      .from(schema.attempts)
      .where(eq(schema.attempts.deliveryId, deliveryId));
    expect(attemptRows[0]?.statusCode).toBeNull();
    expect(attemptRows[0]?.error).toEqual(expect.any(String));
  });

  it("is a no-op when the Delivery is not pending (idempotency guard)", async () => {
    handler = (_req, res) => {
      res.writeHead(200);
      res.end();
    };
    const deliveryId = await seedDelivery({ endpointUrl: stubUrl });
    await processDeliveryJob({ db: testDb.db, defaultTimeoutMs: 2_000 }, deliveryId);

    let calls = 0;
    handler = (_req, res) => {
      calls += 1;
      res.writeHead(200);
      res.end();
    };
    await processDeliveryJob({ db: testDb.db, defaultTimeoutMs: 2_000 }, deliveryId);

    expect(calls).toBe(0);
    const record = await getDeliveryForProcessing(testDb.db, deliveryId);
    expect(record?.attemptCount).toBe(1);
  });
});
