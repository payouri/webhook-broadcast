// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FRESHNESS_POLL_MS } from "../src/lib/freshness.js";
import {
  readJsonBody,
  renderRoutes,
  requestMethod,
  requestPath,
  stubFetchMock,
} from "./fetchMock.js";

const CHANNEL_ID = "11111111-1111-1111-1111-111111111111";
const ENDPOINT_ID = "22222222-2222-2222-2222-222222222222";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function channelBody() {
  return {
    id: CHANNEL_ID,
    slug: "orders",
    description: null,
    enabled: true,
    endpointCount: 1,
    hasBroadcasts: true,
    recentFailedDeliveryCount: 0,
    autoDisabledEndpointCount: 0,
    tokens: [],
    deletedAt: null,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
  };
}

interface EndpointJson {
  id: string;
  channelId: string;
  name: string | null;
  url: string;
  timeoutMs: number | null;
  headers: Record<string, string>;
  enabled: boolean;
  autoDisabledAt: string | null;
  successRate24h: number | null;
  p95Ms: number | null;
  lastSuccessAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function endpointBody(overrides: Partial<EndpointJson> = {}): EndpointJson {
  return {
    id: ENDPOINT_ID,
    channelId: CHANNEL_ID,
    name: "Primary",
    url: "https://example.com/hook",
    timeoutMs: 5000,
    headers: {},
    enabled: true,
    autoDisabledAt: null,
    successRate24h: null,
    p95Ms: null,
    lastSuccessAt: null,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

describe("Channel Detail — Endpoints tab", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let endpoints: Array<ReturnType<typeof endpointBody>>;

  beforeEach(() => {
    endpoints = [endpointBody()];
    fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);

      if (path === `/channels/${CHANNEL_ID}` && method === "GET") {
        return jsonResponse(200, channelBody());
      }
      if (path === `/channels/${CHANNEL_ID}/endpoints` && method === "GET") {
        return jsonResponse(200, { items: endpoints, nextCursor: null });
      }
      if (path === `/channels/${CHANNEL_ID}/endpoints` && method === "POST") {
        const body = (await readJsonBody(input, init)) as Partial<EndpointJson>;
        const created = endpointBody({
          id: "33333333-3333-3333-3333-333333333333",
          ...body,
        });
        endpoints = [...endpoints, created];
        return jsonResponse(201, created);
      }
      if (path === `/channels/${CHANNEL_ID}/endpoints/${ENDPOINT_ID}` && method === "PATCH") {
        const patch = (await readJsonBody(input, init)) as Partial<EndpointJson>;
        const updated: EndpointJson = { ...endpoints[0]!, ...patch };
        endpoints = [updated, ...endpoints.slice(1)];
        return jsonResponse(200, updated);
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });
    stubFetchMock(fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("lists existing Endpoints under the Endpoints tab", async () => {
    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("button", { name: "Endpoints" }));

    expect(await screen.findByText("Primary")).toBeTruthy();
    expect(screen.getByText("https://example.com/hook")).toBeTruthy();
  });

  it("shows auto-disabled state and health aggregates on the Endpoints tab", async () => {
    endpoints = [
      endpointBody({
        enabled: false,
        autoDisabledAt: "2026-08-10T12:00:00.000Z",
        successRate24h: 0.5,
        p95Ms: 120,
        lastSuccessAt: "2026-08-09T18:00:00.000Z",
      }),
    ];
    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("button", { name: "Endpoints" }));

    expect(await screen.findByText(/auto-disabled/i)).toBeTruthy();
    expect(screen.getByText(/50% ok \(24h\)/)).toBeTruthy();
    expect(screen.getByText(/p95 120ms/)).toBeTruthy();
  });

  it("creates a new Endpoint from the Endpoints tab form", async () => {
    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("button", { name: "Endpoints" }));
    await screen.findByText("Primary");

    fireEvent.change(screen.getByLabelText("URL", { selector: "#endpoint-url-new" }), {
      target: { value: "https://example.com/new" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Endpoint" }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            requestPath(input) === `/channels/${CHANNEL_ID}/endpoints` &&
            requestMethod(input, init) === "POST",
        ),
      ).toBe(true);
    });
    expect(await screen.findByText("https://example.com/new")).toBeTruthy();
  });

  it("edits an existing Endpoint in place", async () => {
    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("button", { name: "Endpoints" }));
    fireEvent.click(await screen.findByText("Primary"));

    const nameInput = await screen.findByLabelText("Name", {
      selector: `#endpoint-name-${ENDPOINT_ID}`,
    });
    fireEvent.change(nameInput, { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            requestPath(input) === `/channels/${CHANNEL_ID}/endpoints/${ENDPOINT_ID}` &&
            requestMethod(input, init) === "PATCH",
        ),
      ).toBe(true);
    });
    expect(await screen.findByText("Renamed")).toBeTruthy();
  });

  it("polls Endpoints every ~5s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    renderRoutes(`/channels/${CHANNEL_ID}`);
    fireEvent.click(await screen.findByRole("button", { name: "Endpoints" }));
    await screen.findByText("Primary");

    const endpointCalls = () =>
      fetchMock.mock.calls.filter(
        ([input, init]) =>
          requestPath(input) === `/channels/${CHANNEL_ID}/endpoints` &&
          requestMethod(input, init) === "GET",
      ).length;

    await act(async () => {
      await Promise.resolve();
    });
    const initialCalls = endpointCalls();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FRESHNESS_POLL_MS);
    });
    expect(endpointCalls()).toBe(initialCalls + 1);
  });

  it("shows a Retry control when Endpoints fail to load", async () => {
    let shouldFail = true;

    fetchMock.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);

      if (path === `/channels/${CHANNEL_ID}` && method === "GET") {
        return jsonResponse(200, channelBody());
      }
      if (path === `/channels/${CHANNEL_ID}/broadcasts` && method === "GET") {
        return jsonResponse(200, { items: [], nextCursor: null });
      }
      if (path === `/channels/${CHANNEL_ID}/endpoints` && method === "GET") {
        if (shouldFail) {
          return jsonResponse(500, { error: { message: "server down" } });
        }
        return jsonResponse(200, { items: endpoints, nextCursor: null });
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    renderRoutes(`/channels/${CHANNEL_ID}`);
    fireEvent.click(await screen.findByRole("button", { name: "Endpoints" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();

    shouldFail = false;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await Promise.resolve();
    });

    expect(await screen.findByText("Primary")).toBeTruthy();
  });
});
