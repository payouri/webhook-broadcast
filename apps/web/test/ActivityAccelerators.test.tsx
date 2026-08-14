// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderRoutes, requestMethod, requestPath, stubFetchMock } from "./fetchMock.js";

const CHANNEL_ID = "11111111-1111-1111-1111-111111111111";
const BROADCAST_ID_A = "22222222-2222-2222-2222-222222222222";
const BROADCAST_ID_B = "33333333-3333-3333-3333-333333333333";
const DELIVERY_OK = "44444444-4444-4444-4444-444444444444";
const DELIVERY_FAIL = "55555555-5555-5555-5555-555555555555";
const DELIVERY_THIRD = "66666666-6666-6666-6666-666666666666";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function baseChannel() {
  return {
    id: CHANNEL_ID,
    slug: "orders",
    description: "Order events",
    enabled: true,
    endpointCount: 0,
    hasBroadcasts: true,
    recentFailedDeliveryCount: 2,
    autoDisabledEndpointCount: 0,
    tokens: [],
    deletedAt: null,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
  };
}

function broadcastListItem(id: string, preview: string) {
  return {
    id,
    channelId: CHANNEL_ID,
    receivedAt: "2026-08-10T12:00:00.000Z",
    bodyPreview: preview,
    fanout: { total: 2, succeeded: 0, failed: 0, deadLettered: 2, pending: 0 },
  };
}

function deliveryItem(id: string, endpointName: string, status = "dead_lettered") {
  return {
    id,
    endpointId: `endpoint-${id}`,
    endpointName,
    endpointUrl: `https://example.com/${endpointName}`,
    status,
    attemptCount: 8,
    lastStatusCode: 503,
    lastDurationMs: 42,
    lastError: "service unavailable",
    updatedAt: "2026-08-10T12:00:00.000Z",
  };
}

describe("Activity accelerators — keyboard traversal (issue #53)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    stubFetchMock(fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("moves focus between Broadcast rows with the arrow keys, and jumps with Home/End", async () => {
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);
      if (path === `/channels/${CHANNEL_ID}` && method === "GET") {
        return Promise.resolve(jsonResponse(200, baseChannel()));
      }
      if (path === `/channels/${CHANNEL_ID}/broadcasts` && method === "GET") {
        return Promise.resolve(
          jsonResponse(200, {
            items: [
              broadcastListItem(BROADCAST_ID_A, "first-payload"),
              broadcastListItem(BROADCAST_ID_B, "second-payload"),
            ],
            nextCursor: null,
          }),
        );
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    renderRoutes(`/channels/${CHANNEL_ID}`);
    fireEvent.click(await screen.findByRole("link", { name: "Activity" }));

    const firstRow = await screen.findByRole("button", { name: /first-payload/ });
    const secondRow = await screen.findByRole("button", { name: /second-payload/ });

    firstRow.focus();
    expect(document.activeElement).toBe(firstRow);

    fireEvent.keyDown(firstRow, { key: "ArrowDown" });
    expect(document.activeElement).toBe(secondRow);

    fireEvent.keyDown(secondRow, { key: "ArrowUp" });
    expect(document.activeElement).toBe(firstRow);

    fireEvent.keyDown(firstRow, { key: "End" });
    expect(document.activeElement).toBe(secondRow);

    fireEvent.keyDown(secondRow, { key: "Home" });
    expect(document.activeElement).toBe(firstRow);
  });

  it("keeps arrow traversal inside the Delivery list of an expanded Broadcast", async () => {
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);
      if (path === `/channels/${CHANNEL_ID}` && method === "GET") {
        return Promise.resolve(jsonResponse(200, baseChannel()));
      }
      if (path === `/channels/${CHANNEL_ID}/broadcasts` && method === "GET") {
        return Promise.resolve(
          jsonResponse(200, {
            items: [
              broadcastListItem(BROADCAST_ID_A, "first-payload"),
              broadcastListItem(BROADCAST_ID_B, "second-payload"),
            ],
            nextCursor: null,
          }),
        );
      }
      if (path === `/channels/${CHANNEL_ID}/broadcasts/${BROADCAST_ID_A}` && method === "GET") {
        return Promise.resolve(
          jsonResponse(200, {
            id: BROADCAST_ID_A,
            channelId: CHANNEL_ID,
            receivedAt: "2026-08-10T12:00:00.000Z",
            contentType: "application/json",
            body: "first-payload",
            deliveries: [
              deliveryItem(DELIVERY_OK, "orders-webhook"),
              deliveryItem(DELIVERY_FAIL, "billing-webhook"),
              deliveryItem(DELIVERY_THIRD, "shipping-webhook"),
            ],
          }),
        );
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    renderRoutes(`/channels/${CHANNEL_ID}`);
    fireEvent.click(await screen.findByRole("link", { name: "Activity" }));

    const broadcastRow = await screen.findByRole("button", { name: /first-payload/ });
    fireEvent.click(broadcastRow);

    const firstDelivery = await screen.findByRole("button", { name: /orders-webhook/ });
    const secondDelivery = screen.getByRole("button", { name: /billing-webhook/ });

    // The Delivery list is nested inside the Activity list's own `<li>`, so both
    // lists see the keydown. Each list may only move focus among its own rows:
    // one ArrowDown is one row, never two, and Home stays in the Delivery list
    // rather than jumping out to the first Broadcast.
    firstDelivery.focus();
    fireEvent.keyDown(firstDelivery, { key: "ArrowDown" });
    expect(document.activeElement).toBe(secondDelivery);

    fireEvent.keyDown(secondDelivery, { key: "Home" });
    expect(document.activeElement).toBe(firstDelivery);
  });

  it("advertises its shortcuts from the interface", async () => {
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);
      if (path === `/channels/${CHANNEL_ID}` && method === "GET") {
        return Promise.resolve(jsonResponse(200, baseChannel()));
      }
      if (path === `/channels/${CHANNEL_ID}/broadcasts` && method === "GET") {
        return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    renderRoutes(`/channels/${CHANNEL_ID}`);
    fireEvent.click(await screen.findByRole("link", { name: "Activity" }));

    const disclosure = await screen.findByText("Keyboard shortcuts");
    fireEvent.click(disclosure);
    expect(await screen.findByText(/Move between Broadcast rows/)).toBeTruthy();
    expect(screen.getByText(/Collapse the open Broadcast/)).toBeTruthy();
  });

  it("Escape collapses an expanded Broadcast and returns focus to its row", async () => {
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);
      if (path === `/channels/${CHANNEL_ID}` && method === "GET") {
        return Promise.resolve(jsonResponse(200, baseChannel()));
      }
      if (path === `/channels/${CHANNEL_ID}/broadcasts` && method === "GET") {
        return Promise.resolve(
          jsonResponse(200, {
            items: [broadcastListItem(BROADCAST_ID_A, "first-payload")],
            nextCursor: null,
          }),
        );
      }
      if (path === `/channels/${CHANNEL_ID}/broadcasts/${BROADCAST_ID_A}` && method === "GET") {
        return Promise.resolve(
          jsonResponse(200, {
            id: BROADCAST_ID_A,
            channelId: CHANNEL_ID,
            receivedAt: "2026-08-10T12:00:00.000Z",
            contentType: "application/json",
            body: "first-payload",
            deliveries: [],
          }),
        );
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    renderRoutes(`/channels/${CHANNEL_ID}`);
    fireEvent.click(await screen.findByRole("link", { name: "Activity" }));

    const row = await screen.findByRole("button", { name: /first-payload/ });
    fireEvent.click(row);
    expect(await screen.findByText("first-payload", { selector: "pre" })).toBeTruthy();
    expect(row.getAttribute("aria-expanded")).toBe("true");

    fireEvent.keyDown(row.closest("li") as HTMLElement, { key: "Escape" });

    await waitFor(() => {
      expect(row.getAttribute("aria-expanded")).toBe("false");
    });
    expect(document.activeElement).toBe(row);
  });
});

describe("Bulk retry of dead-lettered Deliveries (issue #53)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    stubFetchMock(fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function stubCommon(): void {
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);
      if (path === `/channels/${CHANNEL_ID}` && method === "GET") {
        return Promise.resolve(jsonResponse(200, baseChannel()));
      }
      if (path === `/channels/${CHANNEL_ID}/broadcasts` && method === "GET") {
        return Promise.resolve(
          jsonResponse(200, {
            items: [broadcastListItem(BROADCAST_ID_A, "fan-out-payload")],
            nextCursor: null,
          }),
        );
      }
      if (path === `/channels/${CHANNEL_ID}/broadcasts/${BROADCAST_ID_A}` && method === "GET") {
        return Promise.resolve(
          jsonResponse(200, {
            id: BROADCAST_ID_A,
            channelId: CHANNEL_ID,
            receivedAt: "2026-08-10T12:00:00.000Z",
            contentType: "application/json",
            body: "fan-out-payload",
            deliveries: [
              deliveryItem(DELIVERY_OK, "orders-webhook"),
              deliveryItem(DELIVERY_FAIL, "billing-webhook"),
            ],
          }),
        );
      }
      if (path === `/deliveries/${DELIVERY_OK}/retry` && method === "POST") {
        return Promise.resolve(
          jsonResponse(200, deliveryItem(DELIVERY_OK, "orders-webhook", "pending")),
        );
      }
      if (path === `/deliveries/${DELIVERY_FAIL}/retry` && method === "POST") {
        return Promise.resolve(
          jsonResponse(409, {
            error: { code: "conflict", message: "only dead_lettered Deliveries can be retried" },
          }),
        );
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });
  }

  it("states how many Deliveries it will retry before it runs", async () => {
    stubCommon();
    renderRoutes(`/channels/${CHANNEL_ID}`);
    fireEvent.click(await screen.findByRole("link", { name: "Activity" }));
    fireEvent.click(await screen.findByText("fan-out-payload"));

    const trigger = await screen.findByRole("button", { name: /Retry 2 dead-lettered/ });
    fireEvent.click(trigger);

    const confirmRegion = await screen.findByRole("group", { name: /Confirm retry/ });
    expect(confirmRegion.textContent).toMatch(/Retry\s*2\s*dead-lettered Deliveries\?/);
  });

  it("reports the outcome per Delivery, leaving a partial failure's successes queued", async () => {
    stubCommon();
    renderRoutes(`/channels/${CHANNEL_ID}`);
    fireEvent.click(await screen.findByRole("link", { name: "Activity" }));
    fireEvent.click(await screen.findByText("fan-out-payload"));

    fireEvent.click(await screen.findByRole("button", { name: /Retry 2 dead-lettered/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm retry" }));

    // Per-Delivery, not a single aggregate: the queued one and the one that
    // did not queue are both named, with the failing one's own reason.
    await waitFor(() => {
      expect(screen.getByText(/orders-webhook: queued for retry/)).toBeTruthy();
    });
    expect(
      screen.getByText(/billing-webhook: only dead_lettered Deliveries can be retried/),
    ).toBeTruthy();

    // The successful retry actually queued (both routes were called), and the
    // failure did not roll it back.
    const retryCalls = fetchMock.mock.calls.filter(
      ([input, init]) =>
        requestPath(input).startsWith("/deliveries/") &&
        requestPath(input).endsWith("/retry") &&
        requestMethod(input, init) === "POST",
    );
    expect(retryCalls).toHaveLength(2);
  });

  it("keeps focus in the document when a successful retry removes its own trigger", async () => {
    // Every dead-lettered Delivery queues, so the refetch that follows leaves
    // none: the trigger the operator pressed is gone by the time it lands, and
    // focus must move to the outcome report rather than falling back to the
    // body with nothing on screen ringed.
    let detailFetches = 0;
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);
      if (path === `/channels/${CHANNEL_ID}` && method === "GET") {
        return Promise.resolve(jsonResponse(200, baseChannel()));
      }
      if (path === `/channels/${CHANNEL_ID}/broadcasts` && method === "GET") {
        return Promise.resolve(
          jsonResponse(200, {
            items: [broadcastListItem(BROADCAST_ID_A, "fan-out-payload")],
            nextCursor: null,
          }),
        );
      }
      if (path === `/channels/${CHANNEL_ID}/broadcasts/${BROADCAST_ID_A}` && method === "GET") {
        detailFetches += 1;
        const status = detailFetches === 1 ? "dead_lettered" : "pending";
        return Promise.resolve(
          jsonResponse(200, {
            id: BROADCAST_ID_A,
            channelId: CHANNEL_ID,
            receivedAt: "2026-08-10T12:00:00.000Z",
            contentType: "application/json",
            body: "fan-out-payload",
            deliveries: [deliveryItem(DELIVERY_OK, "orders-webhook", status)],
          }),
        );
      }
      if (path === `/deliveries/${DELIVERY_OK}/retry` && method === "POST") {
        return Promise.resolve(
          jsonResponse(200, deliveryItem(DELIVERY_OK, "orders-webhook", "pending")),
        );
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    renderRoutes(`/channels/${CHANNEL_ID}`);
    fireEvent.click(await screen.findByRole("link", { name: "Activity" }));
    fireEvent.click(await screen.findByText("fan-out-payload"));

    fireEvent.click(await screen.findByRole("button", { name: /Retry 1 dead-lettered/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm retry" }));

    const report = await screen.findByRole("status", { name: "Bulk retry outcome" });
    expect(report.textContent).toMatch(/orders-webhook: queued for retry/);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /^Retry \d+ dead-lettered/ })).toBeNull();
    });
    expect(document.activeElement).toBe(report);
  });

  it("Escape cancels the confirm region without retrying", async () => {
    stubCommon();
    renderRoutes(`/channels/${CHANNEL_ID}`);
    fireEvent.click(await screen.findByRole("link", { name: "Activity" }));
    fireEvent.click(await screen.findByText("fan-out-payload"));

    const trigger = await screen.findByRole("button", { name: /Retry 2 dead-lettered/ });
    fireEvent.click(trigger);
    const confirmRegion = await screen.findByRole("group", { name: /Confirm retry/ });

    fireEvent.keyDown(confirmRegion, { key: "Escape" });

    const restoredTrigger = await screen.findByRole("button", { name: /Retry 2 dead-lettered/ });
    expect(screen.queryByRole("button", { name: "Confirm retry" })).toBeNull();
    expect(document.activeElement).toBe(restoredTrigger);

    const retryCalls = fetchMock.mock.calls.filter(
      ([input, init]) =>
        requestPath(input).startsWith("/deliveries/") &&
        requestPath(input).endsWith("/retry") &&
        requestMethod(input, init) === "POST",
    );
    expect(retryCalls).toHaveLength(0);
  });
});
