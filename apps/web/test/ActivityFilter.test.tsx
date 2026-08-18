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
    ingestSuccessStatus: null,
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

/**
 * The "All Broadcasts" branch of the toggle (issue #98, formerly "All" over a
 * client-side filter): unchanged behavior — a flat, newest-first,
 * cursor-paginated log with no grouping. The reactive "Failures by Endpoint"
 * branch is covered in `ChannelFailuresByEndpoint.test.tsx`, since it now
 * fetches and renders a different shape entirely.
 */
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
    if (path === `/channels/${CHANNEL_ID}/failures` && method === "GET") {
      return Promise.resolve(jsonResponse(200, { items: [] }));
    }
    throw new Error(`unexpected fetch: ${method} ${path}`);
  };
}

describe("Activity view toggle (issue #98)", () => {
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

  it("shows the flat chronological log under 'All Broadcasts', reading as the active choice", async () => {
    fetchMock.mockImplementation(channelDetailFetches());
    window.history.pushState({}, "", `/channels/${CHANNEL_ID}`);

    render(<App />);

    expect(await screen.findByText("all-succeeded")).toBeTruthy();
    expect(screen.getByText("one-failed")).toBeTruthy();
    expect(screen.getByText("one-dead-lettered")).toBeTruthy();

    // Every Broadcast row carries a fan-out status stamp (2026-08-13 critique,
    // issue #49): Signal Live for the all-succeeded row, Signal Cut for both
    // failure rows, since `failed` and `dead_lettered` are both terminal (ADR
    // 0003).
    const hasBadge = (text: string, tone: string) =>
      screen
        .getAllByText(text)
        .some((node) => node.className.includes("lamp") && node.className.includes(tone));
    expect(hasBadge("1/1 succeeded", "lamp-live")).toBe(true);
    expect(hasBadge("1 failed, 0/1 succeeded", "lamp-cut")).toBe(true);
    expect(hasBadge("1 dead-lettered, 0/1 succeeded", "lamp-cut")).toBe(true);

    expect(
      screen.getByRole("button", { name: "All Broadcasts" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "Failures by Endpoint" }).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("switches to the reactive view and back, updating the URL and the pressed control each way", async () => {
    fetchMock.mockImplementation(channelDetailFetches());
    window.history.pushState({}, "", `/channels/${CHANNEL_ID}`);

    render(<App />);
    await screen.findByText("all-succeeded");

    fireEvent.click(screen.getByRole("button", { name: "Failures by Endpoint" }));

    await waitFor(() => {
      expect(window.location.search).toContain("filter=failed");
    });
    expect(screen.queryByText("all-succeeded")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Failures by Endpoint" }).getAttribute("aria-pressed"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "All Broadcasts" }));
    expect(await screen.findByText("all-succeeded")).toBeTruthy();
    expect(window.location.search).not.toContain("filter=failed");
  });

  it("navigates the Channel directory's health badge into the reactive view", async () => {
    fetchMock.mockImplementation(channelDetailFetches(3));

    render(<App />);

    fireEvent.click(await screen.findByText("3 failing (24h)"));

    // Issue #56: the directory links the slug form, not the id.
    await waitFor(() => {
      expect(window.location.pathname).toBe("/channels/orders/activity");
    });
    expect(window.location.search).toContain("filter=failed");
    expect(await screen.findByRole("button", { name: "Failures by Endpoint" })).toBeTruthy();
  });

  it("navigates a healthy Channel's row straight to the unfiltered Channel view", async () => {
    fetchMock.mockImplementation(channelDetailFetches(0));

    render(<App />);

    fireEvent.click(await screen.findByText("No failures (24h)"));

    // Issue #56: the directory links the slug form, not the id.
    await waitFor(() => {
      expect(window.location.pathname).toBe("/channels/orders");
    });
    expect(window.location.search).toBe("");
  });
});
