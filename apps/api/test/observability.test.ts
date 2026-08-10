import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Channel, ChannelTokenCreated, Endpoint } from "@webhook-broadcast/contract";
import { Queue, Worker } from "bullmq";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import {
  BullMqDeliveryQueue,
  DELIVERY_QUEUE_NAME,
  type DeliveryJobData,
} from "../src/deliveryQueue.js";
import { createHealthServer } from "../src/healthServer.js";
import { MetricsCollector } from "../src/observability/metrics.js";
import { processDeliveryJob } from "../src/worker/processDeliveryJob.js";
import { FakeDeliveryQueue } from "./fakeDeliveryQueue.js";
import { startTestDb, type TestDb } from "./testDb.js";

const OPERATOR_API_KEY = "test-operator-key";
const COOKIE_NAME = "wb_operator";

function parsePrometheusNames(body: string): string[] {
  const names = new Set<string>();
  for (const line of body.split("\n")) {
    if (line.startsWith("# TYPE ")) {
      names.add(line.slice("# TYPE ".length).split(" ")[0] ?? "");
      continue;
    }
    if (line && !line.startsWith("#")) {
      names.add(line.split("{")[0]?.split(" ")[0] ?? "");
    }
  }
  return [...names].filter(Boolean);
}

describe("observability (metrics and structured logs)", () => {
  describe("GET /metrics on API", () => {
    let server: Server;
    let baseUrl: string;
    let metrics: MetricsCollector;
    let deliveryQueue: BullMqDeliveryQueue;

    beforeAll(async () => {
      const redis = await new RedisContainer("redis:7-alpine").start();
      metrics = new MetricsCollector();
      deliveryQueue = new BullMqDeliveryQueue(redis.getConnectionUrl());
      const app = createApp({
        db: {} as never,
        deliveryQueue,
        operatorApiKey: OPERATOR_API_KEY,
        cookieName: COOKIE_NAME,
        metrics,
        renderMetrics: () => metrics.render(deliveryQueue.bullQueue),
      });
      server = createServer(app.callback());
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
    }, 60_000);

    afterAll(async () => {
      await deliveryQueue.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it("returns Prometheus text with BullMQ export and locked app series", async () => {
      metrics.ingestAcceptedTotal.inc();
      metrics.workerConcurrency.set(10);

      const response = await fetch(`${baseUrl}/metrics`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/plain");

      const body = await response.text();
      const names = parsePrometheusNames(body);
      expect(names).toEqual(
        expect.arrayContaining([
          "wb_ingest_accepted_total",
          "wb_attempt_duration_seconds",
          "wb_attempt_results_total",
          "wb_queue_depth",
          "wb_worker_concurrency",
          "bullmq_job_count",
        ]),
      );
    });
  });

  describe("GET /metrics on worker health server", () => {
    let server: Server;
    let baseUrl: string;
    let redis: StartedRedisContainer;
    let queue: Queue<DeliveryJobData>;

    beforeAll(async () => {
      redis = await new RedisContainer("redis:7-alpine").start();
      queue = new Queue<DeliveryJobData>(DELIVERY_QUEUE_NAME, {
        connection: { url: redis.getConnectionUrl() },
      });
      const metrics = new MetricsCollector();
      metrics.workerConcurrency.set(5);
      server = createHealthServer({
        renderMetrics: () => metrics.render(queue),
      });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
    }, 60_000);

    afterAll(async () => {
      await queue.close();
      await redis.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it("returns Prometheus text with BullMQ export and locked app series", async () => {
      const response = await fetch(`${baseUrl}/metrics`);
      expect(response.status).toBe(200);
      const body = await response.text();
      const names = parsePrometheusNames(body);
      expect(names).toEqual(
        expect.arrayContaining([
          "wb_attempt_duration_seconds",
          "wb_queue_depth",
          "wb_worker_concurrency",
          "bullmq_job_count",
        ]),
      );
    });
  });

  describe("structured JSON logs on ingest and delivery", () => {
    let testDb: TestDb;
    let redis: StartedRedisContainer;
    let apiServer: Server;
    let stubServer: Server;
    let apiBaseUrl: string;
    let stubBaseUrl: string;
    let deliveryQueue: BullMqDeliveryQueue;
    let worker: Worker<DeliveryJobData>;
    let logLines: string[];

    beforeAll(async () => {
      testDb = await startTestDb();
      redis = await new RedisContainer("redis:7-alpine").start();

      stubServer = createServer((_req, res) => {
        res.writeHead(200);
        res.end("ok");
      });
      await new Promise<void>((resolve) => stubServer.listen(0, resolve));
      stubBaseUrl = `http://127.0.0.1:${(stubServer.address() as AddressInfo).port}`;

      deliveryQueue = new BullMqDeliveryQueue(redis.getConnectionUrl());
      const metrics = new MetricsCollector();
      const app = createApp({
        db: testDb.db,
        deliveryQueue,
        operatorApiKey: OPERATOR_API_KEY,
        cookieName: COOKIE_NAME,
        metrics,
      });
      apiServer = createServer(app.callback());
      await new Promise<void>((resolve) => apiServer.listen(0, resolve));
      apiBaseUrl = `http://127.0.0.1:${(apiServer.address() as AddressInfo).port}`;

      worker = new Worker<DeliveryJobData>(
        DELIVERY_QUEUE_NAME,
        async (job) => {
          await processDeliveryJob(
            {
              db: testDb.db,
              defaultTimeoutMs: 2_000,
              metrics,
            },
            job.data.deliveryId,
            job.data,
          );
        },
        { connection: { url: redis.getConnectionUrl() }, concurrency: 1 },
      );
      await worker.waitUntilReady();
    }, 120_000);

    afterEach(() => {
      logLines.length = 0;
    });

    afterAll(async () => {
      await worker.close();
      await deliveryQueue.close();
      await new Promise<void>((resolve) => apiServer.close(() => resolve()));
      await new Promise<void>((resolve) => stubServer.close(() => resolve()));
      await testDb.stop();
      await redis.stop();
    }, 60_000);

    it("emits correlated ids on ingest and delivery without leaking secrets", async () => {
      logLines = [];
      vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        logLines.push(args.map(String).join(" "));
      });

      const channelResponse = await fetch(`${apiBaseUrl}/channels`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${OPERATOR_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ slug: "orders" }),
      });
      const channel = (await channelResponse.json()) as Channel;

      const endpointResponse = await fetch(`${apiBaseUrl}/channels/${channel.id}/endpoints`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${OPERATOR_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ url: `${stubBaseUrl}/ok` }),
      });
      const endpoint = (await endpointResponse.json()) as Endpoint;

      const mintResponse = await fetch(`${apiBaseUrl}/channels/${channel.id}/tokens`, {
        method: "POST",
        headers: { authorization: `Bearer ${OPERATOR_API_KEY}` },
      });
      const { token } = (await mintResponse.json()) as ChannelTokenCreated;

      const payload = JSON.stringify({ secretPayload: "must-not-log" });
      const ingestResponse = await fetch(`${apiBaseUrl}/ingest/orders`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-secret-header": "also-secret",
        },
        body: payload,
      });
      expect(ingestResponse.status).toBe(202);
      const { id: broadcastId } = (await ingestResponse.json()) as { id: string };

      const deadline = Date.now() + 10_000;
      let deliveryDone = false;
      while (Date.now() < deadline && !deliveryDone) {
        const detailResponse = await fetch(
          `${apiBaseUrl}/channels/${channel.id}/broadcasts/${broadcastId}`,
          { headers: { authorization: `Bearer ${OPERATOR_API_KEY}` } },
        );
        const detail = (await detailResponse.json()) as {
          deliveries: { status: string; endpointId: string }[];
        };
        deliveryDone = detail.deliveries.some((d) => d.status === "succeeded");
        if (!deliveryDone) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      expect(deliveryDone).toBe(true);

      const jsonLogs = logLines.map((line) => JSON.parse(line) as Record<string, unknown>);
      const ingestLog = jsonLogs.find((entry) => entry.msg === "ingest accepted");
      expect(ingestLog).toMatchObject({
        channelId: channel.id,
        broadcastId,
      });
      expect(typeof ingestLog?.requestId).toBe("string");

      const deliveryLog = jsonLogs.find((entry) => entry.msg === "delivery attempt finished");
      expect(deliveryLog).toMatchObject({
        channelId: channel.id,
        broadcastId,
        endpointId: endpoint.id,
        requestId: ingestLog?.requestId,
      });

      const joined = logLines.join("\n");
      expect(joined).not.toContain(token);
      expect(joined).not.toContain("must-not-log");
      expect(joined).not.toContain("also-secret");
      expect(joined).not.toContain("Bearer ");

      vi.restoreAllMocks();
    }, 30_000);
  });

  describe("FakeDeliveryQueue enqueue shape", () => {
    it("stores full DeliveryJobData including requestId", async () => {
      const queue = new FakeDeliveryQueue();
      await queue.enqueue({
        deliveryId: "d1",
        requestId: "r1",
        channelId: "c1",
        broadcastId: "b1",
        endpointId: "e1",
      });
      expect(queue.enqueued[0]).toEqual({
        deliveryId: "d1",
        requestId: "r1",
        channelId: "c1",
        broadcastId: "b1",
        endpointId: "e1",
      });
    });
  });
});
