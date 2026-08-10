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
 * Full process-boundary loop (issue #19 AC): real Postgres + real Redis +
 * a real BullMQ `Queue`/`Worker` pair + a stub HTTP target — ingest over
 * HTTP through to a persisted Attempt, exactly like `server.ts`/`worker.ts`
 * wire it in production, minus the two separate OS processes.
 */
describe("ingest → queue → worker → Attempt (process-boundary integration)", () => {
  let testDb: TestDb;
  let redis: StartedRedisContainer;
  let apiServer: Server;
  let apiBaseUrl: string;
  let stubServer: Server;
  let stubBaseUrl: string;
  let deliveryQueue: BullMqDeliveryQueue;
  let worker: Worker<DeliveryJobData>;

  beforeAll(async () => {
    testDb = await startTestDb();
    redis = await new RedisContainer("redis:7-alpine").start();

    stubServer = createServer((req, res) => {
      if (req.url === "/fail") {
        res.writeHead(503);
        res.end("try later");
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ received: true }));
    });
    await new Promise<void>((resolve) => stubServer.listen(0, resolve));
    const stubPort = (stubServer.address() as AddressInfo).port;
    stubBaseUrl = `http://127.0.0.1:${stubPort}`;

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

  it("delivers to a stub Endpoint end-to-end: 202 accept → Delivery pending → worker Attempt → succeeded", async () => {
    const channelResponse = await fetch(
      `${apiBaseUrl}/channels`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "orders" }),
      }),
    );
    const channel = (await channelResponse.json()) as Channel;

    const okEndpointResponse = await fetch(
      `${apiBaseUrl}/channels/${channel.id}/endpoints`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: `${stubBaseUrl}/ok` }),
      }),
    );
    const okEndpoint = (await okEndpointResponse.json()) as Endpoint;

    const failEndpointResponse = await fetch(
      `${apiBaseUrl}/channels/${channel.id}/endpoints`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: `${stubBaseUrl}/fail` }),
      }),
    );
    const failEndpoint = (await failEndpointResponse.json()) as Endpoint;

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
    const { id: broadcastId } = (await ingestResponse.json()) as { id: string };

    const detail = await waitForDetail(
      channel.id,
      broadcastId,
      (current) =>
        current.deliveries.length === 2 &&
        current.deliveries.every(
          (delivery) => delivery.status === "succeeded" || delivery.status === "failed",
        ),
    );

    expect(detail.contentType).toBe("application/json");
    expect(detail.body).toBe(JSON.stringify({ orderId: "abc-123" }));

    const okDelivery = detail.deliveries.find((delivery) => delivery.endpointId === okEndpoint.id);
    expect(okDelivery).toMatchObject({ status: "succeeded", lastStatusCode: 200 });

    const failDelivery = detail.deliveries.find(
      (delivery) => delivery.endpointId === failEndpoint.id,
    );
    expect(failDelivery).toMatchObject({ status: "failed", lastStatusCode: 503 });

    const activityResponse = await fetch(
      `${apiBaseUrl}/channels/${channel.id}/broadcasts`,
      authed(),
    );
    const activity = (await activityResponse.json()) as {
      items: { id: string; fanout: { total: number; succeeded: number; failed: number } }[];
    };
    const activityItem = activity.items.find((item) => item.id === broadcastId);
    expect(activityItem?.fanout).toMatchObject({ total: 2, succeeded: 1, failed: 1 });
  }, 30_000);
});
