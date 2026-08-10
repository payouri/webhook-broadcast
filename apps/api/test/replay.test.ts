import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import type {
  BroadcastDetail,
  Channel,
  ChannelTokenCreated,
  Endpoint,
} from "@webhook-broadcast/contract";
import { Worker } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import {
  BullMqDeliveryQueue,
  DELIVERY_QUEUE_NAME,
  type DeliveryJobData,
} from "../src/deliveryQueue.js";
import { processDeliveryJob } from "../src/worker/processDeliveryJob.js";
import { startTestDb, type TestDb } from "./testDb.js";

const OPERATOR_API_KEY = "test-operator-key";
const COOKIE_NAME = "wb_operator";

/**
 * Replay's worker-boundary AC (issue #22): a real Postgres + real Redis +
 * real BullMQ `Queue`/`Worker` pair + a stub HTTP target, proving replay's
 * new Deliveries flow through the exact same queue/worker path as a fresh
 * ingest — down to a persisted Attempt — without a second `POST /ingest`.
 */
describe("replay → queue → worker → Attempt (process-boundary integration)", () => {
  let testDb: TestDb;
  let redis: StartedRedisContainer;
  let apiServer: Server;
  let apiBaseUrl: string;
  let stubServer: Server;
  let stubBaseUrl: string;
  let stubCallCount: number;
  let deliveryQueue: BullMqDeliveryQueue;
  let worker: Worker<DeliveryJobData>;

  beforeAll(async () => {
    testDb = await startTestDb();
    redis = await new RedisContainer("redis:7-alpine").start();

    stubServer = createServer((_req, res) => {
      stubCallCount += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ received: true }));
    });
    await new Promise<void>((resolve) => stubServer.listen(0, resolve));
    const stubPort = (stubServer.address() as AddressInfo).port;
    stubBaseUrl = `http://127.0.0.1:${stubPort}`;
    stubCallCount = 0;

    deliveryQueue = new BullMqDeliveryQueue(redis.getConnectionUrl());
    const app = createApp({
      db: testDb.db,
      deliveryQueue,
      operatorApiKey: OPERATOR_API_KEY,
      cookieName: COOKIE_NAME,
    });
    apiServer = createServer(app.callback());
    await new Promise<void>((resolve) => apiServer.listen(0, resolve));
    const apiPort = (apiServer.address() as AddressInfo).port;
    apiBaseUrl = `http://127.0.0.1:${apiPort}`;

    worker = new Worker<DeliveryJobData>(
      DELIVERY_QUEUE_NAME,
      async (job) => {
        await processDeliveryJob({ db: testDb.db, defaultTimeoutMs: 2_000 }, job.data.deliveryId);
      },
      { connection: { url: redis.getConnectionUrl() }, concurrency: 5 },
    );
    await worker.waitUntilReady();
  }, 120_000);

  afterAll(async () => {
    await worker.close();
    await deliveryQueue.close();
    await new Promise<void>((resolve) => apiServer.close(() => resolve()));
    await new Promise<void>((resolve) => stubServer.close(() => resolve()));
    await testDb.stop();
    await redis.stop();
  }, 60_000);

  function authed(init: RequestInit = {}): RequestInit {
    return { ...init, headers: { authorization: `Bearer ${OPERATOR_API_KEY}`, ...init.headers } };
  }

  async function waitForDetail(
    channelId: string,
    broadcastId: string,
    predicate: (detail: BroadcastDetail) => boolean,
    timeoutMs = 10_000,
  ): Promise<BroadcastDetail> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const response = await fetch(
        `${apiBaseUrl}/channels/${channelId}/broadcasts/${broadcastId}`,
        authed(),
      );
      const detail = (await response.json()) as BroadcastDetail;
      if (predicate(detail)) {
        return detail;
      }
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for Broadcast detail: ${JSON.stringify(detail)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  it("replays a retained Broadcast without a new ingest: new Broadcast, new Delivery, new Attempt", async () => {
    const channelResponse = await fetch(
      `${apiBaseUrl}/channels`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "orders" }),
      }),
    );
    const channel = (await channelResponse.json()) as Channel;

    const endpointResponse = await fetch(
      `${apiBaseUrl}/channels/${channel.id}/endpoints`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: `${stubBaseUrl}/hook` }),
      }),
    );
    const endpoint = (await endpointResponse.json()) as Endpoint;

    const mintResponse = await fetch(
      `${apiBaseUrl}/channels/${channel.id}/tokens`,
      authed({ method: "POST" }),
    );
    const { token } = (await mintResponse.json()) as ChannelTokenCreated;

    const ingestResponse = await fetch(`${apiBaseUrl}/ingest/orders`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ orderId: "abc-123" }),
    });
    expect(ingestResponse.status).toBe(202);
    const { id: originalId } = (await ingestResponse.json()) as { id: string };

    const originalDetail = await waitForDetail(
      channel.id,
      originalId,
      (current) => current.deliveries.length === 1 && current.deliveries[0]?.status === "succeeded",
    );
    const originalDeliveryId = originalDetail.deliveries[0]?.id;
    expect(stubCallCount).toBe(1);

    // Replay is not a new ingest: no ingest token, no POST /ingest/orders.
    const replayResponse = await fetch(
      `${apiBaseUrl}/channels/${channel.id}/broadcasts/${originalId}/replay`,
      authed({ method: "POST" }),
    );
    expect(replayResponse.status).toBe(202);
    const { id: replayId } = (await replayResponse.json()) as { id: string };
    expect(replayId).not.toBe(originalId);

    const replayDetail = await waitForDetail(
      channel.id,
      replayId,
      (current) => current.deliveries.length === 1 && current.deliveries[0]?.status === "succeeded",
    );

    expect(replayDetail.contentType).toBe(originalDetail.contentType);
    expect(replayDetail.body).toBe(originalDetail.body);
    expect(replayDetail.deliveries[0]).toMatchObject({
      endpointId: endpoint.id,
      status: "succeeded",
      lastStatusCode: 200,
    });
    expect(replayDetail.deliveries[0]?.id).not.toBe(originalDeliveryId);
    expect(stubCallCount).toBe(2);

    // The original Broadcast's Delivery is untouched by the replay.
    const originalAfterReplay = await waitForDetail(channel.id, originalId, () => true, 2_000);
    expect(originalAfterReplay.deliveries).toHaveLength(1);
    expect(originalAfterReplay.deliveries[0]?.id).toBe(originalDeliveryId);
  }, 30_000);
});
