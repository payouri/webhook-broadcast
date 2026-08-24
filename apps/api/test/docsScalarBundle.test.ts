import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Database } from "@webhook-broadcast/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDeliveryQueue } from "./fakeDeliveryQueue.js";

const OPERATOR_API_KEY = "test-operator-key";

// Every read this app attempts of Scalar's standalone bundle, recorded and
// then failed. The bundle is ~4 MB read off disk, and a deployment can
// plausibly be missing it (a pruned production image, or a future release of
// `@scalar/api-reference` moving the file). What must never happen is the api
// refusing to *boot* over it: the failure belongs to `GET /docs/scalar.js`,
// and a deployment with `DOCS_ENABLED=false` must not touch the file at all.
const bundleReads: string[] = [];

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: (path: unknown, ...rest: unknown[]) => {
      const asString = String(path);
      if (asString.endsWith("standalone.js")) {
        bundleReads.push(asString);
        throw new Error("simulated missing Scalar bundle");
      }
      return (actual.readFileSync as (...args: unknown[]) => unknown)(path, ...rest);
    },
  };
});

const { createApp } = await import("../src/app.js");

async function startApp(docsEnabled?: boolean): Promise<{ server: Server; baseUrl: string }> {
  const app = createApp({
    db: {} as Database,
    deliveryQueue: new FakeDeliveryQueue(),
    operatorApiKey: OPERATOR_API_KEY,
    cookieName: "wb_operator",
    ...(docsEnabled === undefined ? {} : { docsEnabled }),
  });
  const server = createServer(app.callback());
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

describe("GET /docs/scalar.js when the bundle cannot be read", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(() => {
    bundleReads.length = 0;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("does not read the bundle while constructing the app", async () => {
    ({ server, baseUrl } = await startApp());
    expect(bundleReads).toEqual([]);
  });

  it("fails only its own route, leaving the rest of the api serving", async () => {
    ({ server, baseUrl } = await startApp());

    const bundle = await fetch(`${baseUrl}/docs/scalar.js`, {
      headers: { authorization: `Bearer ${OPERATOR_API_KEY}` },
    });
    expect(bundle.status).toBe(500);
    expect(bundleReads.length).toBeGreaterThan(0);

    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);
    const docs = await fetch(`${baseUrl}/docs`, {
      headers: { authorization: `Bearer ${OPERATOR_API_KEY}` },
    });
    expect(docs.status).toBe(200);
  });

  it("never touches the bundle when DOCS_ENABLED is false", async () => {
    ({ server, baseUrl } = await startApp(false));
    const response = await fetch(`${baseUrl}/docs/scalar.js`, {
      headers: { authorization: `Bearer ${OPERATOR_API_KEY}` },
    });
    expect(response.status).toBe(404);
    expect(bundleReads).toEqual([]);
  });
});
