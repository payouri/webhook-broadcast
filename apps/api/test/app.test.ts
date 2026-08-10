import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Database } from "@webhook-broadcast/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { FakeDeliveryQueue } from "./fakeDeliveryQueue.js";

describe("API liveness and readiness probes", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    // Liveness never touches Postgres; /ready is covered in ready.test.ts.
    const app = createApp({
      db: {} as Database,
      deliveryQueue: new FakeDeliveryQueue(),
      operatorApiKey: "test-operator-key",
      cookieName: "wb_operator",
    });
    server = createServer(app.callback());
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("GET /health returns 200 with status ok", async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("unknown routes 404", async () => {
    const response = await fetch(`${baseUrl}/nope`);
    expect(response.status).toBe(404);
  });
});
