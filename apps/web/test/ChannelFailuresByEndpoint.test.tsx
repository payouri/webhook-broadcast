// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FRESHNESS_POLL_MS } from "../src/lib/freshness.js";
import { createQueryClient } from "../src/lib/queryClient.js";
import { AppRoutes } from "../src/routes.js";
import { renderRoutes, requestMethod, requestPath, stubFetchMock } from "./fetchMock.js";

/**
 * `renderRoutes` mounts the app under `MemoryRouter`, so `window.location`
 * never moves and the URL-owned expansion state (`?endpoint=`) can only be
 * read back through the router itself. This probe renders the router's current
 * search string into the tree for the round-trip assertions; every other test
 * here uses the shared `renderRoutes`.
 */
function LocationProbe() {
  const location = useLocation();
  return <span data-testid="router-search">{location.search}</span>;
}

function renderRoutesWithLocationProbe(initialPath: string) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[initialPath]}>
        <AppRoutes />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function endpointParam(): string | null {
  return new URLSearchParams(screen.getByTestId("router-search").textContent ?? "").get("endpoint");
}

const CHANNEL_ID = "11111111-1111-1111-1111-111111111111";
const ENDPOINT_A_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ENDPOINT_B_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const BROADCAST_A1 = "a1111111-1111-1111-1111-111111111111";
const BROADCAST_A2 = "a2222222-2222-2222-2222-222222222222";
const BROADCAST_B1 = "b1111111-1111-1111-1111-111111111111";

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
    endpointCount: 2,
    hasBroadcasts: true,
    recentFailedDeliveryCount: 8,
    tokens: [],
    deletedAt: null,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
  };
}

/** Endpoint A ranks first: auto-disabled outranks any count (issue #84's SQL order). */
function endpointA() {
  return {
    endpointId: ENDPOINT_A_ID,
    endpointName: null,
    endpointUrl: "https://a.example/hook",
    failed: 2,
    deadLettered: 1,
    autoDisabledAt: "2026-08-15T06:00:00.000Z",
    lastFailureAt: "2026-08-15T06:30:00.000Z",
  };
}

function endpointB() {
  return {
    endpointId: ENDPOINT_B_ID,
    endpointName: "Billing",
    endpointUrl: "https://b.example/hook",
    failed: 1,
    deadLettered: 0,
    autoDisabledAt: null,
    lastFailureAt: "2026-08-15T06:00:00.000Z",
  };
}

function broadcastA1() {
  return {
    id: BROADCAST_A1,
    channelId: CHANNEL_ID,
    receivedAt: "2026-08-15T06:30:00.000Z",
    bodyPreview: "a1-body",
    fanout: { total: 1, succeeded: 0, failed: 0, deadLettered: 1, pending: 0 },
    delivery: {
      deliveryId: "d1111111-1111-1111-1111-111111111111",
      status: "dead_lettered",
      lastStatusCode: 503,
      lastDurationMs: 4200,
      lastError: null,
      attemptCount: 4,
    },
  };
}

function broadcastA2() {
  return {
    id: BROADCAST_A2,
    channelId: CHANNEL_ID,
    receivedAt: "2026-08-15T06:00:00.000Z",
    bodyPreview: "a2-body",
    fanout: { total: 1, succeeded: 0, failed: 1, deadLettered: 0, pending: 0 },
    delivery: {
      deliveryId: "d2222222-2222-2222-2222-222222222222",
      status: "failed",
      lastStatusCode: null,
      lastDurationMs: 15000,
      lastError: "timeout",
      attemptCount: 1,
    },
  };
}

function broadcastB1() {
  return {
    id: BROADCAST_B1,
    channelId: CHANNEL_ID,
    receivedAt: "2026-08-15T06:00:00.000Z",
    bodyPreview: "b1-body",
    fanout: { total: 1, succeeded: 0, failed: 1, deadLettered: 0, pending: 0 },
    delivery: {
      deliveryId: "d3333333-3333-3333-3333-333333333333",
      status: "failed",
      lastStatusCode: 500,
      lastDurationMs: 1000,
      lastError: null,
      attemptCount: 1,
    },
  };
}

interface FetchScript {
  rollupItems: unknown[];
}

/**
 * A shared fixture: two Endpoint groups (A auto-disabled and top-ranked, B a
 * plain failure), each with a two-page child list (A) or one-page list (B),
 * so pagination, lazy loading, and ranking can all be exercised against one
 * mock. `script.rollupItems` is read on every roll-up call, so a test can
 * mutate it between polls to simulate a group clearing.
 */
function groupedFetches(
  script: FetchScript,
): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return (input, init) => {
    const path = requestPath(input);
    const method = requestMethod(input, init);
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      "http://localhost",
    );

    if (path === "/auth/session") {
      return Promise.resolve(jsonResponse(200, { ok: true }));
    }
    if (path === "/channels" && method === "GET") {
      return Promise.resolve(jsonResponse(200, { items: [baseChannel()], nextCursor: null }));
    }
    if (path === `/channels/${CHANNEL_ID}` && method === "GET") {
      return Promise.resolve(jsonResponse(200, baseChannel()));
    }
    if (path === `/channels/${CHANNEL_ID}/failures` && method === "GET") {
      return Promise.resolve(jsonResponse(200, { items: script.rollupItems }));
    }
    if (path === `/channels/${CHANNEL_ID}/broadcasts` && method === "GET") {
      const endpointId = url.searchParams.get("endpointId");
      const cursor = url.searchParams.get("cursor");
      if (endpointId === ENDPOINT_A_ID) {
        return Promise.resolve(
          jsonResponse(
            200,
            cursor === "a-page-2"
              ? { items: [broadcastA2()], nextCursor: null }
              : { items: [broadcastA1()], nextCursor: "a-page-2" },
          ),
        );
      }
      if (endpointId === ENDPOINT_B_ID) {
        return Promise.resolve(jsonResponse(200, { items: [broadcastB1()], nextCursor: null }));
      }
      throw new Error(`unexpected broadcasts fetch: ${url.search}`);
    }
    if (
      (path === `/channels/${CHANNEL_ID}/broadcasts/${BROADCAST_A1}` ||
        path === `/channels/${CHANNEL_ID}/broadcasts/${BROADCAST_A2}` ||
        path === `/channels/${CHANNEL_ID}/broadcasts/${BROADCAST_B1}`) &&
      method === "GET"
    ) {
      const id = path.split("/").pop();
      return Promise.resolve(
        jsonResponse(200, {
          id,
          channelId: CHANNEL_ID,
          receivedAt: "2026-08-15T06:30:00.000Z",
          contentType: "application/json",
          body: `${id}-detail`,
          deliveries: [],
        }),
      );
    }
    throw new Error(`unexpected fetch: ${method} ${path}`);
  };
}

/**
 * Issue #98: the reactive Activity view groups a Channel's recent failures by
 * Endpoint, in the server's ranked order, with children fetched lazily and
 * paginated per group, all URL-owned via `?endpoint=`.
 */
describe("Failures by Endpoint (issue #98)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    stubFetchMock(fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("renders groups in server order with lamp, identity, composed counts, and last-failure time, opening the top group with zero clicks", async () => {
    fetchMock.mockImplementation(groupedFetches({ rollupItems: [endpointA(), endpointB()] }));

    renderRoutes(`/channels/${CHANNEL_ID}/activity?filter=failed`);

    // Endpoint A: no name, so the URL is the fallback identity.
    expect(await screen.findByText("https://a.example/hook")).toBeTruthy();
    // Composed the way ChannelHealthLamp composes its parts, all three legs
    // present since A is auto-disabled *and* has both counts.
    expect(screen.getByText("auto-disabled · 1 dead-lettered · 2 failed")).toBeTruthy();
    // Endpoint B has a name, which wins over its URL.
    expect(screen.getByText("Billing")).toBeTruthy();
    expect(screen.getByText("1 failed")).toBeTruthy();

    // Server order preserved: A's header renders before B's in the DOM.
    const aIndex = screen
      .getByText("https://a.example/hook")
      .compareDocumentPosition(screen.getByText("Billing"));
    // Node.DOCUMENT_POSITION_FOLLOWING === 4: B follows A in the document.
    expect(aIndex & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // The top-ranked group (A) opened with zero clicks: its first page of
    // failing Broadcasts is already visible.
    expect(await screen.findByText("a1-body")).toBeTruthy();
    expect(screen.getByText("503 after 4.2s")).toBeTruthy();

    // B never fetched until expanded.
    expect(screen.queryByText("b1-body")).toBeNull();
    expect(screen.getByRole("button", { name: /Billing/ }).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("loads a collapsed group's children lazily on expand, and again shows that Endpoint's Delivery cause", async () => {
    fetchMock.mockImplementation(groupedFetches({ rollupItems: [endpointA(), endpointB()] }));

    renderRoutes(`/channels/${CHANNEL_ID}/activity?filter=failed`);
    await screen.findByText("a1-body");

    expect(screen.queryByText("b1-body")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Billing/ }));

    expect(await screen.findByText("b1-body")).toBeTruthy();
    expect(screen.getByText("500 after 1.0s")).toBeTruthy();
  });

  it("paginates a group's children with its own Load more, without disturbing the other group", async () => {
    fetchMock.mockImplementation(groupedFetches({ rollupItems: [endpointA(), endpointB()] }));

    renderRoutes(`/channels/${CHANNEL_ID}/activity?filter=failed`);
    await screen.findByText("a1-body");
    expect(screen.queryByText("a2-body")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByText("a2-body")).toBeTruthy();
    // A network-level failure (no status code): the error text and the
    // duration in milliseconds, not seconds.
    expect(screen.getByText("timeout 15000ms")).toBeTruthy();
    // A1 is still there too — "Load more" appends, it does not replace.
    expect(screen.getByText("a1-body")).toBeTruthy();
  });

  it("opens the existing Broadcast detail panel, unchanged, when a child row expands", async () => {
    fetchMock.mockImplementation(groupedFetches({ rollupItems: [endpointA()] }));

    renderRoutes(`/channels/${CHANNEL_ID}/activity?filter=failed`);
    await screen.findByText("a1-body");

    fireEvent.click(screen.getByText("a1-body"));

    expect(await screen.findByText(`${BROADCAST_A1}-detail`)).toBeTruthy();
  });

  it("URL round-trips expansion: present-and-empty opens nothing, and a toggle writes the full explicit set", async () => {
    fetchMock.mockImplementation(groupedFetches({ rollupItems: [endpointA(), endpointB()] }));

    // Present but empty: the operator collapsed everything, and it must not
    // spring back open to the top-ranked default.
    renderRoutesWithLocationProbe(`/channels/${CHANNEL_ID}/activity?filter=failed&endpoint=`);
    await screen.findByText("https://a.example/hook");
    expect(screen.queryByText("a1-body")).toBeNull();
    expect(
      screen.getByRole("button", { name: /example\/hook/ }).getAttribute("aria-expanded"),
    ).toBe("false");

    // Every toggle writes the whole set back explicitly, so the URL is always
    // the complete answer rather than a diff against a default.
    fireEvent.click(screen.getByRole("button", { name: /Billing/ }));
    await waitFor(() => {
      expect(endpointParam()).toBe(ENDPOINT_B_ID);
    });

    fireEvent.click(screen.getByRole("button", { name: /example\/hook/ }));
    await waitFor(() => {
      expect(endpointParam()?.split(",")).toEqual(
        expect.arrayContaining([ENDPOINT_A_ID, ENDPOINT_B_ID]),
      );
    });

    // And collapsing both back down leaves the sentinel behind, not an absent
    // param that would re-open the top-ranked group.
    fireEvent.click(screen.getByRole("button", { name: /Billing/ }));
    fireEvent.click(screen.getByRole("button", { name: /example\/hook/ }));
    await waitFor(() => {
      expect(endpointParam()).toBe("");
    });
    expect(screen.queryByText("a1-body")).toBeNull();
    expect(screen.queryByText("b1-body")).toBeNull();
  });

  it("restores exactly the groups a shared ?endpoint= URL names, top-ranked or not", async () => {
    fetchMock.mockImplementation(groupedFetches({ rollupItems: [endpointA(), endpointB()] }));

    // B alone: the operator's own choice wins over the top-ranked default, and
    // A stays shut even though it ranks first.
    renderRoutes(`/channels/${CHANNEL_ID}/activity?filter=failed&endpoint=${ENDPOINT_B_ID}`);

    expect(await screen.findByText("b1-body")).toBeTruthy();
    expect(screen.queryByText("a1-body")).toBeNull();
    expect(
      screen.getByRole("button", { name: /example\/hook/ }).getAttribute("aria-expanded"),
    ).toBe("false");
    expect(screen.getByRole("button", { name: /Billing/ }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("scopes row-to-row keyboard traversal separately for group headers and their children", async () => {
    fetchMock.mockImplementation(groupedFetches({ rollupItems: [endpointA(), endpointB()] }));

    renderRoutes(`/channels/${CHANNEL_ID}/activity?filter=failed`);
    await screen.findByText("a1-body");

    const groupA = screen.getByRole("button", { name: /example\/hook/ });
    const groupB = screen.getByRole("button", { name: /Billing/ });
    const childA1 = screen.getByText("a1-body").closest("button");

    // The header sequence skips the expanded group's children entirely: from
    // A's header, ArrowDown lands on B's header, not on A's child rows.
    groupA.focus();
    fireEvent.keyDown(groupA, { key: "ArrowDown" });
    expect(document.activeElement).toBe(groupB);

    // And the children sequence does not leak back out into the headers: A has
    // a single child on its first page, so End stays on it.
    childA1?.focus();
    fireEvent.keyDown(childA1!, { key: "End" });
    expect(document.activeElement).toBe(childA1);
  });

  it("shows the domain-worded empty state naming the 24h window, without offering to load further back", async () => {
    fetchMock.mockImplementation(groupedFetches({ rollupItems: [] }));

    renderRoutes(`/channels/${CHANNEL_ID}/activity?filter=failed`);

    expect(
      await screen.findByText("No failed or dead-lettered Deliveries in the last 24 hours."),
    ).toBeTruthy();
    expect(screen.queryByText(/load further back/i)).toBeNull();
    expect(screen.queryByText(/load more/i)).toBeNull();
  });

  it("keeps an expanded group rendered, cleared, once its in-window count reaches zero — until collapsed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const script: FetchScript = { rollupItems: [endpointA()] };
    fetchMock.mockImplementation(groupedFetches(script));

    renderRoutes(`/channels/${CHANNEL_ID}/activity?filter=failed`);
    await act(async () => {
      await Promise.resolve();
    });
    expect(await screen.findByText("a1-body")).toBeTruthy();

    // The operator retries it back to health (or it ages out): the next poll's
    // roll-up no longer lists Endpoint A at all.
    script.rollupItems = [];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FRESHNESS_POLL_MS);
    });

    // Still rendered — the header survives — with the cleared message where
    // its children were, not the count text that is now stale.
    expect(screen.getByText("https://a.example/hook")).toBeTruthy();
    expect(screen.getByText("No failures in the last 24 hours.")).toBeTruthy();
    expect(screen.queryByText("auto-disabled · 1 dead-lettered · 2 failed")).toBeNull();
    expect(screen.queryByText("a1-body")).toBeNull();
  });
});
