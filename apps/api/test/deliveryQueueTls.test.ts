import { afterEach, describe, expect, it, vi } from "vitest";

interface CapturedQueueOptions {
  connection: { url: string; tls?: unknown };
}

interface CapturedRedisOptions {
  url: string;
  opts: { tls?: unknown };
}

const queueConstructorCalls: CapturedQueueOptions[] = [];
const redisConstructorCalls: CapturedRedisOptions[] = [];

// Unit-level double for bullmq/ioredis: this test only cares which `tls`
// object each construction site is handed, not real queue/connection
// behaviour (that's covered by the testcontainers-backed
// deliveryQueue.test.ts).
vi.mock("bullmq", () => {
  class Queue {
    constructor(_name: string, options: CapturedQueueOptions) {
      queueConstructorCalls.push(options);
    }
    async close(): Promise<void> {}
  }
  return { Queue };
});

vi.mock("ioredis", () => {
  class Redis {
    constructor(url: string, opts: CapturedRedisOptions["opts"]) {
      redisConstructorCalls.push({ url, opts });
    }
    async connect(): Promise<void> {}
    async ping(): Promise<string> {
      return "PONG";
    }
    disconnect(): void {}
  }
  return { Redis };
});

const { BullMqDeliveryQueue } = await import("../src/deliveryQueue.js");

describe("BullMqDeliveryQueue TLS wiring", () => {
  afterEach(() => {
    queueConstructorCalls.length = 0;
    redisConstructorCalls.length = 0;
  });

  it("ping() resolves the same TLS config as the Queue connection it backs", async () => {
    const url = "rediss://u:p@redis.example.com:6380";
    const caCert = "-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----";

    const queue = new BullMqDeliveryQueue(url, 5, caCert);
    await queue.ping();

    expect(queueConstructorCalls).toHaveLength(1);
    expect(queueConstructorCalls[0]!.connection.tls).toEqual({
      ca: caCert,
      rejectUnauthorized: true,
    });

    expect(redisConstructorCalls).toHaveLength(1);
    expect(redisConstructorCalls[0]!.opts.tls).toEqual(queueConstructorCalls[0]!.connection.tls);
  });

  it("plaintext redis:// carries no tls config on either the Queue or ping()'s client", async () => {
    const url = "redis://redis.example.com:6379";

    const queue = new BullMqDeliveryQueue(url);
    await queue.ping();

    expect(queueConstructorCalls[0]!.connection.tls).toBeUndefined();
    expect(redisConstructorCalls[0]!.opts.tls).toBeUndefined();
  });
});
