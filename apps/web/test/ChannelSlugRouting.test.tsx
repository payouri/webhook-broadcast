// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { idSchema } from "@webhook-broadcast/contract";
import { isChannelId } from "../src/lib/channelRef.js";
import { FRESHNESS_POLL_MS } from "../src/lib/freshness.js";
import { renderRoutes, requestMethod, requestPath, stubFetchMock } from "./fetchMock.js";

const CHANNEL_ID = "11111111-1111-1111-1111-111111111111";
const BROADCAST_ID = "22222222-2222-2222-2222-222222222222";
const ENDPOINT_ID = "33333333-3333-3333-3333-333333333333";
const SLUG = "stripe-prod";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function baseChannel() {
  return {
    id: CHANNEL_ID,
    slug: SLUG,
    description: "Stripe events",
    enabled: true,
    endpointCount: 0,
    ingestSuccessStatus: null,
    hasBroadcasts: true,
    recentFailedDeliveryCount: 2,
    autoDisabledEndpointCount: 0,
    tokens: [],
    deletedAt: null,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
  };
}

function slugCapableFetches(): (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response> {
  return (input, init) => {
    const path = requestPath(input);
    const method = requestMethod(input, init);
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      "http://localhost",
    );

    // Exact-match slug filter (issue #40) is what the route layer resolves a
    // slug segment through (issue #56) — this stands in for `GET /channels`.
    if (path === "/channels" && method === "GET") {
      const slugFilter = url.searchParams.get("slug");
      const items = slugFilter === null || slugFilter === SLUG ? [baseChannel()] : [];
      return Promise.resolve(jsonResponse(200, { items, nextCursor: null }));
    }
    if (path === `/channels/${CHANNEL_ID}` && method === "GET") {
      return Promise.resolve(jsonResponse(200, baseChannel()));
    }
    if (path === `/channels/${CHANNEL_ID}/failures` && method === "GET") {
      return Promise.resolve(
        jsonResponse(200, {
          items: [
            {
              endpointId: ENDPOINT_ID,
              endpointName: null,
              endpointUrl: "https://example.com/hook",
              failed: 1,
              deadLettered: 0,
              autoDisabledAt: null,
              lastFailureAt: "2026-08-10T12:00:00.000Z",
            },
          ],
        }),
      );
    }
    if (path === `/channels/${CHANNEL_ID}/broadcasts` && method === "GET") {
      const endpointFilter = url.searchParams.get("endpointId");
      return Promise.resolve(
        jsonResponse(200, {
          items: [
            {
              id: BROADCAST_ID,
              channelId: CHANNEL_ID,
              receivedAt: "2026-08-10T12:00:00.000Z",
              bodyPreview: "hello-world",
              fanout: { total: 1, succeeded: 0, failed: 1, deadLettered: 0, pending: 0 },
              ...(endpointFilter
                ? {
                    delivery: {
                      deliveryId: "44444444-4444-4444-4444-444444444444",
                      status: "failed",
                      lastStatusCode: 503,
                      lastDurationMs: 4200,
                      lastError: null,
                      attemptCount: 1,
                    },
                  }
                : {}),
            },
          ],
          nextCursor: null,
        }),
      );
    }
    if (path === `/channels/${CHANNEL_ID}/broadcasts/${BROADCAST_ID}` && method === "GET") {
      return Promise.resolve(
        jsonResponse(200, {
          id: BROADCAST_ID,
          channelId: CHANNEL_ID,
          receivedAt: "2026-08-10T12:00:00.000Z",
          // Deliberately distinct from the list row's `bodyPreview` above:
          // if both fixtures said "hello-world", a test asserting the expanded
          // body would pass on the collapsed row alone.
          contentType: "application/json",
          body: "hello-world-body",
          deliveries: [],
        }),
      );
    }
    throw new Error(`unexpected fetch: ${method} ${path}`);
  };
}

/**
 * Issue #56: the Channel route accepts either the id or the slug, resolving
 * both to the same Channel — including the nested tab, `?filter=`, and
 * expanded-Broadcast forms, each covered by its own test below — and an
 * unknown or since-renamed slug renders the
 * ordinary Channel-not-found view rather than a distinct error.
 */
describe("Channel routes accept a slug (issue #56)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    stubFetchMock(fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("resolves /channels/<slug> to the same page as /channels/<uuid>", async () => {
    fetchMock.mockImplementation(slugCapableFetches());

    renderRoutes(`/channels/${SLUG}`);

    expect(await screen.findByText(SLUG)).toBeTruthy();
    fireEvent.click(await screen.findByRole("link", { name: "Activity" }));
    expect(await screen.findByText("hello-world")).toBeTruthy();
  });

  it("resolves the nested tab and expanded-Broadcast forms through a slug", async () => {
    fetchMock.mockImplementation(slugCapableFetches());

    renderRoutes(`/channels/${SLUG}/activity/${BROADCAST_ID}`);

    expect(await screen.findByText(SLUG)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Activity" }).className).toContain("tab-active");
    // The expanded body, not the collapsed row's preview — the two fixtures
    // differ so this can only pass if the Broadcast well actually opened.
    expect(await screen.findByText(/hello-world-body/)).toBeTruthy();
  });

  it("resolves the ?filter= form through a slug, landing on the reactive view", async () => {
    fetchMock.mockImplementation(slugCapableFetches());

    renderRoutes(`/channels/${SLUG}/activity?filter=failed`);

    expect(await screen.findByText(SLUG)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Activity" }).className).toContain("tab-active");
    // `?filter=failed` selects the reactive failures-by-Endpoint structure, so
    // the proactive log's row is absent and the Endpoint group is present.
    const reactiveToggle = await screen.findByRole("button", { name: "Failures by Endpoint" });
    expect(reactiveToggle.getAttribute("aria-pressed")).toBe("true");
    // The Endpoint group heading only exists on the reactive structure — the
    // proactive log is a flat Broadcast list with no Endpoint grouping.
    expect(await screen.findByText(/example\.com\/hook/)).toBeTruthy();
  });

  it("still resolves the id form without a redirect (neither URL is rewritten)", async () => {
    fetchMock.mockImplementation(slugCapableFetches());

    renderRoutes(`/channels/${CHANNEL_ID}`);

    expect(await screen.findByText(SLUG)).toBeTruthy();
    // Visiting by id stays on the id in the address bar (MemoryRouter has no
    // real `window.location`, so this is asserted via the rendered tab link
    // instead — see the next test for the id preserved through navigation).
    fireEvent.click(await screen.findByRole("link", { name: "Endpoints" }));
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Endpoints" }).className).toContain("tab-active");
    });
  });

  it("renders Channel-not-found for a slug with no current match (e.g. after a rename)", async () => {
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);
      if (path === "/channels" && method === "GET") {
        return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    renderRoutes("/channels/old-renamed-slug");

    expect(await screen.findByRole("heading", { name: "Channel not found" })).toBeTruthy();
  });

  // A lookup that *failed* is not a lookup that found nothing: retries are off
  // app-wide (queryClient.ts), so without its own error branch a single 500 on
  // the resolving request would leave this page on its skeleton indefinitely.
  it("offers a Retry when the slug lookup itself fails, instead of loading forever", async () => {
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);
      if (path === "/channels" && method === "GET") {
        return Promise.resolve(
          jsonResponse(500, { error: { code: "internal_error", message: "lookup unavailable" } }),
        );
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    renderRoutes(`/channels/${SLUG}`);

    // Described for the operator, not echoed: a crash the handler never authored
    // a message for loses its wording but keeps its status (issue #58).
    expect(await screen.findByText(/Failed to load Channel \(HTTP 500\)/)).toBeTruthy();
    expect(screen.queryByText(/lookup unavailable/)).toBeNull();
    // Neither of the two views this must not degrade into.
    expect(screen.queryByRole("heading", { name: "Channel not found" })).toBeNull();
    expect(screen.queryByRole("status", { name: "Loading Channel" })).toBeNull();

    // Retry drives the lookup that failed — the Channel query is still disabled
    // at this point, so retrying that one instead would change nothing.
    fetchMock.mockImplementation(slugCapableFetches());
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("heading", { level: 1, name: SLUG })).toBeTruthy();
  });
});

/**
 * Issue #57: `isChannelId` (`lib/channelRef.ts`) is a loose 8-4-4-4-12 hex
 * shape check, so a hand-typed or corrupted id can pass it and still fail the
 * admin API's stricter `idSchema` (`z.uuid()`, which also checks the version
 * and variant nibbles) — its 400 `channelId must be a UUID` is exactly the
 * internal string this issue must keep off the screen.
 *
 * Deliberately a different value from `CHANNEL_ID` above: this segment must be
 * one the route layer forwards as an id and the API then refuses, which the
 * first test below asserts against the two real checks rather than trusting the
 * mocked 400 to stand for it.
 */
describe("a route segment shaped like a UUID but rejected by the API (issue #57)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const MALFORMED_ID = "deadbeef-dead-dead-dead-deadbeefdead";

  beforeEach(() => {
    fetchMock = vi.fn();
    stubFetchMock(fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function rejectsTheId(): (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response> {
    return (input, init) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);
      if (path === `/channels/${MALFORMED_ID}` && method === "GET") {
        return Promise.resolve(
          jsonResponse(400, {
            error: { code: "validation_failed", message: "channelId must be a UUID" },
          }),
        );
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    };
  }

  // The premise the rest of this block mocks: without this gap between the two
  // checks there is no 400 to keep off the screen, and a tightened `isChannelId`
  // would route this segment to the slug lookup instead.
  it("is a segment the route layer reads as an id but the contract rejects", () => {
    expect(isChannelId(MALFORMED_ID)).toBe(true);
    expect(idSchema.safeParse(MALFORMED_ID).success).toBe(false);
  });

  it.each([
    ["the bare Channel route", `/channels/${MALFORMED_ID}`],
    ["a nested tab", `/channels/${MALFORMED_ID}/settings`],
    [
      "the expanded-Broadcast form",
      `/channels/${MALFORMED_ID}/activity/${BROADCAST_ID}?filter=failed`,
    ],
  ])("renders NotFoundPanel, never the raw validation string, on %s", async (_label, route) => {
    fetchMock.mockImplementation(rejectsTheId());

    renderRoutes(route);

    expect(await screen.findByRole("heading", { name: "Channel not found" })).toBeTruthy();
    expect(screen.queryByText(/channelId must be a UUID/)).toBeNull();
    expect(screen.getByRole("link", { name: /Back to Channels/i })).toBeTruthy();
    // Nothing failed here — the address just never named a view — so the
    // message takes the `.advisory` treatment (Ink, no `role="alert"`), not
    // the Lamp Cut error banner that promises a retryable fault, and it must
    // not borrow the dashed empty-state well that `EmptyState` still owns for
    // a genuinely empty list (issue #57).
    expect(screen.queryByRole("alert")).toBeNull();
    const message = screen.getByText(/may have been deleted/i).closest("p");
    expect(message?.className).toContain("advisory");
    expect(message?.className).not.toContain("empty-state");
    // The 404 sits on a plate like every other screen.
    expect(message?.closest(".plate")).toBeTruthy();
  });

  it("stops polling once the API rejects the id, same as a 404", async () => {
    let detailRequests = 0;
    const rejects = rejectsTheId();
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      if (requestPath(input) === `/channels/${MALFORMED_ID}`) {
        detailRequests += 1;
      }
      return rejects(input, init);
    });

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderRoutes(`/channels/${MALFORMED_ID}`);
      await screen.findByRole("heading", { name: "Channel not found" });

      const afterFirstLoad = detailRequests;
      await vi.advanceTimersByTimeAsync(FRESHNESS_POLL_MS * 4);
      expect(detailRequests).toBe(afterFirstLoad);
    } finally {
      vi.useRealTimers();
    }
  });
});
