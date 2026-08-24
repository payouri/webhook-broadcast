import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Database } from "@webhook-broadcast/db";
import { emitAdminOpenApiDocument, parseAdminOpenApiYaml } from "@webhook-broadcast/contract";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { FakeDeliveryQueue } from "./fakeDeliveryQueue.js";

const OPERATOR_API_KEY = "test-operator-key";

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

describe("GET /openapi.json", () => {
  let server: Server;
  let baseUrl: string;

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("requires an operator credential", async () => {
    ({ server, baseUrl } = await startApp());
    const response = await fetch(`${baseUrl}/openapi.json`);
    expect(response.status).toBe(401);
  });

  it("returns the admin contract for an authenticated request", async () => {
    ({ server, baseUrl } = await startApp());
    const response = await fetch(`${baseUrl}/openapi.json`, {
      headers: { authorization: `Bearer ${OPERATOR_API_KEY}` },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = (await response.json()) as { paths: Record<string, unknown> };
    expect(body.paths["/channels"]).toBeDefined();
    expect(body.paths["/deliveries/{deliveryId}/retry"]).toBeDefined();
    // The route itself is never one of the document's own paths (issue #107).
    expect(body.paths["/openapi.json"]).toBeUndefined();
  });

  it("matches emitAdminOpenApiDocument() emitted from the Zod source", async () => {
    ({ server, baseUrl } = await startApp());
    const response = await fetch(`${baseUrl}/openapi.json`, {
      headers: { authorization: `Bearer ${OPERATOR_API_KEY}` },
    });
    const body = await response.json();
    expect(body).toEqual(emitAdminOpenApiDocument());
  });

  it("sets a strong ETag and no-cache, non-public Cache-Control", async () => {
    ({ server, baseUrl } = await startApp());
    const response = await fetch(`${baseUrl}/openapi.json`, {
      headers: { authorization: `Bearer ${OPERATOR_API_KEY}` },
    });
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(response.headers.get("etag")).toMatch(/^"[0-9a-f]{64}"$/);
  });

  it("returns 304 when If-None-Match matches the current ETag", async () => {
    ({ server, baseUrl } = await startApp());
    const first = await fetch(`${baseUrl}/openapi.json`, {
      headers: { authorization: `Bearer ${OPERATOR_API_KEY}` },
    });
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();

    const second = await fetch(`${baseUrl}/openapi.json`, {
      headers: {
        authorization: `Bearer ${OPERATOR_API_KEY}`,
        "If-None-Match": etag ?? "",
      },
    });
    expect(second.status).toBe(304);
  });

  it("returns 304 for a weakened validator or a multi-entry If-None-Match list", async () => {
    // A reverse proxy that gzips this response rewrites the strong validator
    // to `W/"…"`, and RFC 9110 lets a client send a list. Both must still
    // revalidate, or the ETag stops saving anything in production.
    ({ server, baseUrl } = await startApp());
    const first = await fetch(`${baseUrl}/openapi.json`, {
      headers: { authorization: `Bearer ${OPERATOR_API_KEY}` },
    });
    const etag = first.headers.get("etag") ?? "";

    for (const ifNoneMatch of [`W/${etag}`, `"stale-other-value", ${etag}`]) {
      const response = await fetch(`${baseUrl}/openapi.json`, {
        headers: {
          authorization: `Bearer ${OPERATOR_API_KEY}`,
          "If-None-Match": ifNoneMatch,
        },
      });
      expect(response.status, ifNoneMatch).toBe(304);
    }
  });

  it("returns 200 when If-None-Match carries a stale validator", async () => {
    ({ server, baseUrl } = await startApp());
    const response = await fetch(`${baseUrl}/openapi.json`, {
      headers: {
        authorization: `Bearer ${OPERATOR_API_KEY}`,
        "If-None-Match": `"${"0".repeat(64)}"`,
      },
    });
    expect(response.status).toBe(200);
  });

  it("404s with code docs_disabled when DOCS_ENABLED is false, even authenticated", async () => {
    ({ server, baseUrl } = await startApp(false));
    const response = await fetch(`${baseUrl}/openapi.json`, {
      headers: { authorization: `Bearer ${OPERATOR_API_KEY}` },
    });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "docs_disabled", message: expect.any(String) },
    });
  });
});

describe("GET /openapi.yaml", () => {
  let server: Server;
  let baseUrl: string;

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("requires an operator credential", async () => {
    ({ server, baseUrl } = await startApp());
    const response = await fetch(`${baseUrl}/openapi.yaml`);
    expect(response.status).toBe(401);
  });

  it("parses to the same document as GET /openapi.json", async () => {
    // The test that catches the packaging mistake: a missing `yaml` module
    // in the pruned production image fails loudly here, not silently.
    ({ server, baseUrl } = await startApp());
    const [jsonResponse, yamlResponse] = await Promise.all([
      fetch(`${baseUrl}/openapi.json`, {
        headers: { authorization: `Bearer ${OPERATOR_API_KEY}` },
      }),
      fetch(`${baseUrl}/openapi.yaml`, {
        headers: { authorization: `Bearer ${OPERATOR_API_KEY}` },
      }),
    ]);
    expect(yamlResponse.status).toBe(200);
    expect(yamlResponse.headers.get("content-type")).toContain("application/yaml");
    const jsonBody = await jsonResponse.json();
    const yamlBody = parseAdminOpenApiYaml(await yamlResponse.text());
    expect(yamlBody).toEqual(jsonBody);
    expect(yamlBody).toEqual(emitAdminOpenApiDocument());
  });

  it("sets a strong ETag and no-cache, non-public Cache-Control", async () => {
    ({ server, baseUrl } = await startApp());
    const response = await fetch(`${baseUrl}/openapi.yaml`, {
      headers: { authorization: `Bearer ${OPERATOR_API_KEY}` },
    });
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(response.headers.get("etag")).toMatch(/^"[0-9a-f]{64}"$/);
  });

  it("returns 304 when If-None-Match matches the current ETag", async () => {
    ({ server, baseUrl } = await startApp());
    const first = await fetch(`${baseUrl}/openapi.yaml`, {
      headers: { authorization: `Bearer ${OPERATOR_API_KEY}` },
    });
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();

    const second = await fetch(`${baseUrl}/openapi.yaml`, {
      headers: {
        authorization: `Bearer ${OPERATOR_API_KEY}`,
        "If-None-Match": etag ?? "",
      },
    });
    expect(second.status).toBe(304);
  });

  it("404s with code docs_disabled when DOCS_ENABLED is false, even authenticated", async () => {
    ({ server, baseUrl } = await startApp(false));
    const response = await fetch(`${baseUrl}/openapi.yaml`, {
      headers: { authorization: `Bearer ${OPERATOR_API_KEY}` },
    });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "docs_disabled", message: expect.any(String) },
    });
  });

  it("is not one of the document's own paths", async () => {
    ({ server, baseUrl } = await startApp());
    const response = await fetch(`${baseUrl}/openapi.json`, {
      headers: { authorization: `Bearer ${OPERATOR_API_KEY}` },
    });
    const body = (await response.json()) as { paths: Record<string, unknown> };
    expect(body.paths["/openapi.yaml"]).toBeUndefined();
  });
});
