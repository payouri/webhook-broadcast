// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { requestMethod, requestPath, stubFetchMock } from "./fetchMock.js";

const CHANNEL_ID = "11111111-1111-1111-1111-111111111111";
const OK_BROADCAST_ID = "33333333-3333-3333-3333-333333333333";
const FAILED_BROADCAST_ID = "44444444-4444-4444-4444-444444444444";
const DEAD_LETTERED_BROADCAST_ID = "55555555-5555-5555-5555-555555555555";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function baseChannel(overrides: Partial<{ recentFailedDeliveryCount: number }> = {}) {
  return {
    id: CHANNEL_ID,
    slug: "orders",
    description: "Order events",
    enabled: true,
    endpointCount: 1,
    hasBroadcasts: true,
    recentFailedDeliveryCount: overrides.recentFailedDeliveryCount ?? 0,
    tokens: [],
    deletedAt: null,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
  };
}

const BROADCAST_ITEMS = [
  {
    id: OK_BROADCAST_ID,
    channelId: CHANNEL_ID,
    receivedAt: "2026-08-10T12:00:00.000Z",
    bodyPreview: "all-succeeded",
    fanout: { total: 1, succeeded: 1, failed: 0, deadLettered: 0, pending: 0 },
  },
  {
    id: FAILED_BROADCAST_ID,
    channelId: CHANNEL_ID,
    receivedAt: "2026-08-10T11:00:00.000Z",
    bodyPreview: "one-failed",
    fanout: { total: 1, succeeded: 0, failed: 1, deadLettered: 0, pending: 0 },
  },
  {
    id: DEAD_LETTERED_BROADCAST_ID,
    channelId: CHANNEL_ID,
    receivedAt: "2026-08-10T10:00:00.000Z",
    bodyPreview: "one-dead-lettered",
    fanout: { total: 1, succeeded: 0, failed: 0, deadLettered: 1, pending: 0 },
  },
];

function channelDetailFetches(recentFailedDeliveryCount = 0) {
  return (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const path = requestPath(input);
    const method = requestMethod(input, init);

    if (path === "/auth/session") {
      return Promise.resolve(jsonResponse(200, { ok: true }));
    }
    if (path === "/channels" && method === "GET") {
      return Promise.resolve(
        jsonResponse(200, {
          items: [baseChannel({ recentFailedDeliveryCount })],
          nextCursor: null,
        }),
      );
    }
    if (path === `/channels/${CHANNEL_ID}` && method === "GET") {
      return Promise.resolve(jsonResponse(200, baseChannel({ recentFailedDeliveryCount })));
    }
    if (path === `/channels/${CHANNEL_ID}/broadcasts` && method === "GET") {
      return Promise.resolve(jsonResponse(200, { items: BROADCAST_ITEMS, nextCursor: null }));
    }
    if (path === `/channels/${CHANNEL_ID}/broadcasts/${FAILED_BROADCAST_ID}` && method === "GET") {
      return Promise.resolve(
        jsonResponse(200, {
          id: FAILED_BROADCAST_ID,
          channelId: CHANNEL_ID,
          receivedAt: "2026-08-10T11:00:00.000Z",
          contentType: "application/json",
          body: "one-failed-body",
          deliveries: [],
        }),
      );
    }
    throw new Error(`unexpected fetch: ${method} ${path}`);
  };
}

/**
 * Activity filter by failure (issue #51): the fan-out aggregate already on
 * `BroadcastListItem` drives a client-side filter, its state lives in the URL
 * consistent with issue #42, and the Channel directory's health badge lands
 * directly on the filtered view for a Channel with recent failures.
 */
describe("Activity filter by failure (issue #51)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.history.pushState({}, "", "/");
    fetchMock = vi.fn();
    stubFetchMock(fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows every Broadcast by default, and only failed/dead-lettered ones once filtered", async () => {
    fetchMock.mockImplementation(channelDetailFetches());
    window.history.pushState({}, "", `/channels/${CHANNEL_ID}`);

    render(<App />);

    // Unfiltered: all three Broadcasts, and the "All" option already reads as
    // the active one — the operator does not have to hover to learn that.
    expect(await screen.findByText("all-succeeded")).toBeTruthy();
    expect(screen.getByText("one-failed")).toBeTruthy();
    expect(screen.getByText("one-dead-lettered")).toBeTruthy();

    // Every Broadcast row carries a fan-out status stamp (2026-08-13 critique,
    // issue #49), alongside the pre-existing trailing fan-out detail text —
    // which for the all-succeeded row reads identically, so `getAllByText`
    // disambiguates by checking a badge with that text exists among the
    // matches. Signal Live for the all-succeeded row. Both failure rows are
    // Signal Cut, because `failed` and `dead_lettered` are both terminal (ADR
    // 0003): a non-retryable outcome is never retried, and a retryable one that
    // still has budget is `pending` instead. Each names its own count, so the
    // failures-only filter and these lamps agree about what a failure is.
    const hasBadge = (text: string, tone: string) =>
      screen
        .getAllByText(text)
        .some((node) => node.className.includes("lamp") && node.className.includes(tone));
    expect(hasBadge("1/1 succeeded", "lamp-live")).toBe(true);
    expect(hasBadge("1 failed, 0/1 succeeded", "lamp-cut")).toBe(true);
    expect(hasBadge("1 dead-lettered", "lamp-cut")).toBe(true);

    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Failures only" }).getAttribute("aria-pressed")).toBe(
      "false",
    );

    fireEvent.click(screen.getByRole("button", { name: "Failures only" }));

    // Filtered: only the failed and dead-lettered Broadcasts remain.
    await waitFor(() => {
      expect(screen.queryByText("all-succeeded")).toBeNull();
    });
    expect(screen.getByText("one-failed")).toBeTruthy();
    expect(screen.getByText("one-dead-lettered")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Failures only" }).getAttribute("aria-pressed")).toBe(
      "true",
    );

    // The filter lives in the URL (issue #42's treatment of Channel/tab/Broadcast).
    expect(window.location.search).toContain("filter=failed");

    // Switching back to "All" restores the full list and clears the URL param.
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(await screen.findByText("all-succeeded")).toBeTruthy();
    expect(window.location.search).not.toContain("filter=failed");
  });

  it("lands directly on the filtered Activity view when opened from the failed-filter URL", async () => {
    fetchMock.mockImplementation(channelDetailFetches(2));
    window.history.pushState({}, "", `/channels/${CHANNEL_ID}/activity?filter=failed`);

    render(<App />);

    expect(await screen.findByText("one-failed")).toBeTruthy();
    expect(screen.queryByText("all-succeeded")).toBeNull();
    expect(screen.getByRole("button", { name: "Failures only" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("keeps the filter while a Broadcast is expanded from the filtered list", async () => {
    // The whole point of the filter is drilling from a failure count into the
    // failing Broadcast (PRODUCT.md's "one navigation path"), so opening a
    // Broadcast must not silently drop back to the unfiltered list.
    fetchMock.mockImplementation(channelDetailFetches(2));
    window.history.pushState({}, "", `/channels/${CHANNEL_ID}/activity?filter=failed`);

    render(<App />);

    fireEvent.click(await screen.findByText("one-failed"));

    expect(await screen.findByText("one-failed-body")).toBeTruthy();
    expect(window.location.pathname).toBe(
      `/channels/${CHANNEL_ID}/activity/${FAILED_BROADCAST_ID}`,
    );
    expect(window.location.search).toContain("filter=failed");
    expect(screen.queryByText("all-succeeded")).toBeNull();
    expect(screen.getByRole("button", { name: "Failures only" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("shows a domain-worded empty state when nothing loaded matches the filter", async () => {
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);

      if (path === "/auth/session") {
        return Promise.resolve(jsonResponse(200, { ok: true }));
      }
      if (path === `/channels/${CHANNEL_ID}` && method === "GET") {
        return Promise.resolve(jsonResponse(200, baseChannel()));
      }
      if (path === `/channels/${CHANNEL_ID}/broadcasts` && method === "GET") {
        return Promise.resolve(
          jsonResponse(200, { items: [BROADCAST_ITEMS[0]], nextCursor: null }),
        );
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });
    window.history.pushState({}, "", `/channels/${CHANNEL_ID}`);

    render(<App />);
    await screen.findByText("all-succeeded");

    fireEvent.click(screen.getByRole("button", { name: "Failures only" }));

    expect(await screen.findByText(/have a failed or dead-lettered Delivery/)).toBeTruthy();
  });

  it("navigates the Channel directory's health badge into the filtered Activity view", async () => {
    fetchMock.mockImplementation(channelDetailFetches(3));

    render(<App />);

    fireEvent.click(await screen.findByText("3 failing (24h)"));

    await waitFor(() => {
      expect(window.location.pathname).toBe(`/channels/${CHANNEL_ID}/activity`);
    });
    expect(window.location.search).toContain("filter=failed");
    expect(await screen.findByText("one-failed")).toBeTruthy();
    expect(screen.queryByText("all-succeeded")).toBeNull();
  });

  it("navigates a healthy Channel's row straight to the unfiltered Channel view", async () => {
    fetchMock.mockImplementation(channelDetailFetches(0));

    render(<App />);

    fireEvent.click(await screen.findByText("No failures (24h)"));

    await waitFor(() => {
      expect(window.location.pathname).toBe(`/channels/${CHANNEL_ID}`);
    });
    expect(window.location.search).toBe("");
  });
});
