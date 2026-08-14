// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FRESHNESS_POLL_MS } from "../src/lib/freshness.js";
import {
  renderRoutes,
  requestMethod,
  requestPath,
  requestUrl,
  stubFetchMock,
} from "./fetchMock.js";

const CHANNEL_ID = "11111111-1111-1111-1111-111111111111";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function baseChannel(tokens: { id: string; prefix: string; createdAt: string }[] = []) {
  return {
    id: CHANNEL_ID,
    slug: "orders",
    description: "Order events",
    enabled: true,
    endpointCount: 0,
    hasBroadcasts: true,
    recentFailedDeliveryCount: 0,
    autoDisabledEndpointCount: 0,
    tokens,
    deletedAt: null,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
  };
}

async function flushAsync(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function channelGetCalls(fetchMock: ReturnType<typeof vi.fn>): number {
  return fetchMock.mock.calls.filter(
    ([input, init]) =>
      requestPath(input) === `/channels/${CHANNEL_ID}` && requestMethod(input, init) === "GET",
  ).length;
}

function broadcastListCalls(fetchMock: ReturnType<typeof vi.fn>): number {
  return fetchMock.mock.calls.filter(
    ([input, init]) =>
      requestPath(input) === `/channels/${CHANNEL_ID}/broadcasts` &&
      requestMethod(input, init) === "GET",
  ).length;
}

describe("ChannelDetailPage — Activity tab and ingest tokens", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    stubFetchMock(fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("lists Broadcasts with receivedAt, body preview, and fan-out on the Activity tab", async () => {
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
              {
                id: "22222222-2222-2222-2222-222222222222",
                channelId: CHANNEL_ID,
                receivedAt: "2026-08-10T12:00:00.000Z",
                bodyPreview: "hello-world",
                fanout: { total: 0, succeeded: 0, failed: 0, deadLettered: 0, pending: 0 },
              },
            ],
            nextCursor: null,
          }),
        );
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("link", { name: "Activity" }));

    expect(await screen.findByText("hello-world")).toBeTruthy();
    // The row's leading lamp is the one place the fan-out result is stated; the
    // trailing duplicate of it was removed, not the fact itself.
    expect(screen.getByText("No Endpoints")).toBeTruthy();
  });

  it("shows an empty state when there are no Broadcasts yet", async () => {
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

    expect(await screen.findByText(/No Broadcasts yet/)).toBeTruthy();
  });

  it("mints an ingest token, shows the plaintext once, and revoke requires confirmation", async () => {
    const tokenId = "33333333-3333-3333-3333-333333333333";
    let mintedOnServer = false;
    let revokedOnServer = false;

    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);

      if (path === `/channels/${CHANNEL_ID}` && method === "GET") {
        return Promise.resolve(
          jsonResponse(
            200,
            baseChannel(
              mintedOnServer
                ? [{ id: tokenId, prefix: "wbt_abcd1234", createdAt: "2026-08-10T12:00:00.000Z" }]
                : [],
            ),
          ),
        );
      }
      if (path === `/channels/${CHANNEL_ID}/broadcasts` && method === "GET") {
        return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
      }
      if (path === `/channels/${CHANNEL_ID}/tokens` && method === "POST") {
        mintedOnServer = true;
        return Promise.resolve(
          jsonResponse(201, {
            id: tokenId,
            token: "wbt_abcd1234-plaintext-secret",
            createdAt: "2026-08-10T12:00:00.000Z",
          }),
        );
      }
      if (path === `/channels/${CHANNEL_ID}/tokens/${tokenId}` && method === "DELETE") {
        mintedOnServer = false;
        revokedOnServer = true;
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    renderRoutes(`/channels/${CHANNEL_ID}`);

    // Default hub tab is Activity (ADR 0004); tokens live under Settings.
    fireEvent.click(await screen.findByRole("link", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Mint new token" }));

    expect(await screen.findByText(/wbt_abcd1234-plaintext-secret/)).toBeTruthy();
    expect(await screen.findByText("wbt_abcd1234…")).toBeTruthy();

    // Revoke opens an in-place confirmation instead of revoking immediately.
    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));

    // The confirmation names the affected token and what stops working.
    expect(
      await screen.findByText(/Any producer using wbt_abcd1234… stops being accepted/),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm revoke" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();

    // Nothing was revoked by opening the confirmation.
    expect(revokedOnServer).toBe(false);

    fireEvent.click(await screen.findByRole("button", { name: "Confirm revoke" }));

    // The token itself is gone — not merely the resting row's Revoke button.
    await waitFor(() => {
      expect(screen.queryByText("wbt_abcd1234…")).toBeNull();
    });
    expect(revokedOnServer).toBe(true);
  });

  it("dismisses token revoke confirmation and leaves token untouched", async () => {
    const tokenId = "33333333-3333-3333-3333-333333333333";

    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);

      if (path === `/channels/${CHANNEL_ID}` && method === "GET") {
        return Promise.resolve(
          jsonResponse(
            200,
            baseChannel([
              { id: tokenId, prefix: "wbt_abcd1234", createdAt: "2026-08-10T12:00:00.000Z" },
            ]),
          ),
        );
      }
      if (path === `/channels/${CHANNEL_ID}/broadcasts` && method === "GET") {
        return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("link", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));

    // Confirmation is shown
    expect(await screen.findByText(/Any producer using.*stops being accepted/)).toBeTruthy();

    // Cancel the revoke
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    // Back to the resting row: token still listed, confirmation gone.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Revoke" })).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "Confirm revoke" })).toBeNull();
    expect(screen.getByText("wbt_abcd1234…")).toBeTruthy();

    // Cancelling returns focus to the exact trigger that opened the region
    // (issue #61), not wherever the browser defaults to once it unmounts.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Revoke" }));

    // Dismissing left the token untouched: no revoke ever reached the server.
    const revokeCalls = fetchMock.mock.calls.filter(
      ([input, init]) =>
        requestMethod(input as string | URL | Request, init as RequestInit) === "DELETE",
    );
    expect(revokeCalls).toHaveLength(0);
  });

  it("moves focus into the revoke confirm region on open and closes it on Escape", async () => {
    const tokenId = "33333333-3333-3333-3333-333333333333";

    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);

      if (path === `/channels/${CHANNEL_ID}` && method === "GET") {
        return Promise.resolve(
          jsonResponse(
            200,
            baseChannel([
              { id: tokenId, prefix: "wbt_abcd1234", createdAt: "2026-08-10T12:00:00.000Z" },
            ]),
          ),
        );
      }
      if (path === `/channels/${CHANNEL_ID}/broadcasts` && method === "GET") {
        return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("link", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));

    // The overlay focus contract (DESIGN.md #4): the row this button lived on
    // is gone, so focus moves onto the confirm region's first control rather
    // than falling back to <body>.
    const confirmButton = await screen.findByRole("button", { name: "Confirm revoke" });
    expect(document.activeElement).toBe(confirmButton);

    const region = confirmButton.closest('[role="group"]')!;
    expect(region.getAttribute("aria-label")).toMatch(/wbt_abcd1234/);

    fireEvent.keyDown(confirmButton, { key: "Escape" });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Revoke" })).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "Confirm revoke" })).toBeNull();
    // Escape returns focus to the same trigger a Cancel click would.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Revoke" }));
  });

  it("opens the tokens panel without a second getChannel request (issue #51)", async () => {
    const tokenId = "33333333-3333-3333-3333-333333333333";

    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);

      if (path === `/channels/${CHANNEL_ID}` && method === "GET") {
        return Promise.resolve(
          jsonResponse(
            200,
            baseChannel([
              { id: tokenId, prefix: "wbt_abcd1234", createdAt: "2026-08-10T12:00:00.000Z" },
            ]),
          ),
        );
      }
      if (path === `/channels/${CHANNEL_ID}/broadcasts` && method === "GET") {
        return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
      }
      if (path === `/channels/${CHANNEL_ID}/endpoints` && method === "GET") {
        return Promise.resolve(jsonResponse(200, { items: [] }));
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    renderRoutes(`/channels/${CHANNEL_ID}`);
    await screen.findByText("orders");
    await flushAsync();
    const callsBeforeSettings = channelGetCalls(fetchMock);

    // The tokens panel reads the Channel the page already holds in the
    // ["channel", channelId] cache, so mounting it must not refetch it.
    fireEvent.click(await screen.findByRole("link", { name: "Settings" }));
    expect(await screen.findByText("wbt_abcd1234…")).toBeTruthy();
    await flushAsync();

    expect(channelGetCalls(fetchMock)).toBe(callsBeforeSettings);
  });

  it("replays a Broadcast from its detail panel (issue #76): confirm before replay", async () => {
    const broadcastId = "44444444-4444-4444-4444-444444444444";
    const replayId = "55555555-5555-5555-5555-555555555555";
    let replayCalled = false;

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
              {
                id: broadcastId,
                channelId: CHANNEL_ID,
                receivedAt: "2026-08-10T12:00:00.000Z",
                bodyPreview: "hello-world",
                fanout: { total: 0, succeeded: 0, failed: 0, deadLettered: 0, pending: 0 },
              },
            ],
            nextCursor: null,
          }),
        );
      }
      if (path === `/channels/${CHANNEL_ID}/broadcasts/${broadcastId}` && method === "GET") {
        return Promise.resolve(
          jsonResponse(200, {
            id: broadcastId,
            channelId: CHANNEL_ID,
            receivedAt: "2026-08-10T12:00:00.000Z",
            contentType: "application/json",
            body: "hello-world",
            deliveries: [],
          }),
        );
      }
      // Two enabled and one disabled: the confirmation must count the enabled
      // ones only, since those are the Endpoints the replay will fan out to.
      if (path === `/channels/${CHANNEL_ID}/endpoints` && method === "GET") {
        return Promise.resolve(
          jsonResponse(200, {
            items: [
              {
                id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                channelId: CHANNEL_ID,
                name: "Endpoint 1",
                url: "https://example.com/webhook",
                timeoutMs: null,
                headers: {},
                enabled: true,
                createdAt: "2026-08-10T00:00:00.000Z",
                updatedAt: "2026-08-10T00:00:00.000Z",
              },
              {
                id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                channelId: CHANNEL_ID,
                name: "Endpoint 2",
                url: "https://example.com/webhook-2",
                timeoutMs: null,
                headers: {},
                enabled: true,
                createdAt: "2026-08-10T00:00:00.000Z",
                updatedAt: "2026-08-10T00:00:00.000Z",
              },
              {
                id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
                channelId: CHANNEL_ID,
                name: "Endpoint 3 (off)",
                url: "https://example.com/webhook-3",
                timeoutMs: null,
                headers: {},
                enabled: false,
                createdAt: "2026-08-10T00:00:00.000Z",
                updatedAt: "2026-08-10T00:00:00.000Z",
              },
            ],
            nextCursor: null,
          }),
        );
      }
      if (
        path === `/channels/${CHANNEL_ID}/broadcasts/${broadcastId}/replay` &&
        method === "POST"
      ) {
        replayCalled = true;
        return Promise.resolve(jsonResponse(202, { id: replayId }));
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("link", { name: "Activity" }));
    fireEvent.click(await screen.findByText("hello-world"));
    fireEvent.click(await screen.findByRole("button", { name: "Replay" }));

    // The guard itself: Replay poses a question, it does not fire on that click.
    const confirmRegion = await screen.findByRole("group", { name: "Confirm replay Broadcast" });
    await flushAsync();
    expect(replayCalled).toBe(false);

    // It names the fan-out width in enabled Endpoints (2 of the 3 configured)…
    await waitFor(() => {
      expect(confirmRegion.textContent).toMatch(/Replay to\s*2\s*enabled Endpoints\?/);
    });
    // …and says that width is read now, not from the original fan-out.
    expect(confirmRegion.textContent).toMatch(/Endpoints enabled now, which may differ/);

    fireEvent.click(await screen.findByRole("button", { name: "Confirm replay" }));

    await waitFor(() => {
      expect(replayCalled).toBe(true);
    });
    expect(await screen.findByText(/Replayed/)).toBeTruthy();
  });

  it("cancels a Replay confirmation without firing it (issue #76)", async () => {
    const broadcastId = "44444444-4444-4444-4444-444444444444";
    let replayCalled = false;

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
              {
                id: broadcastId,
                channelId: CHANNEL_ID,
                receivedAt: "2026-08-10T12:00:00.000Z",
                bodyPreview: "hello-world",
                fanout: { total: 0, succeeded: 0, failed: 0, deadLettered: 0, pending: 0 },
              },
            ],
            nextCursor: null,
          }),
        );
      }
      if (path === `/channels/${CHANNEL_ID}/broadcasts/${broadcastId}` && method === "GET") {
        return Promise.resolve(
          jsonResponse(200, {
            id: broadcastId,
            channelId: CHANNEL_ID,
            receivedAt: "2026-08-10T12:00:00.000Z",
            contentType: "application/json",
            body: "hello-world",
            deliveries: [],
          }),
        );
      }
      if (path === `/channels/${CHANNEL_ID}/endpoints` && method === "GET") {
        return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
      }
      if (
        path === `/channels/${CHANNEL_ID}/broadcasts/${broadcastId}/replay` &&
        method === "POST"
      ) {
        replayCalled = true;
        return Promise.resolve(jsonResponse(202, { id: "ignored" }));
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("link", { name: "Activity" }));
    fireEvent.click(await screen.findByText("hello-world"));
    fireEvent.click(await screen.findByRole("button", { name: "Replay" }));

    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    // Back to the bare trigger, focus returned to it, and nothing sent.
    const trigger = await screen.findByRole("button", { name: "Replay" });
    expect(document.activeElement).toBe(trigger);
    await flushAsync();
    expect(replayCalled).toBe(false);
    expect(screen.queryByText(/Replayed/)).toBeNull();
  });

  it("updates the parent Broadcast's lamp in the same interaction as a Delivery retry (issue #72)", async () => {
    const broadcastId = "44444444-4444-4444-4444-444444444444";
    const deliveryId = "66666666-6666-6666-6666-666666666666";
    // The lamp reads the Activity list, not the Broadcast detail. Both sources
    // flip together the moment the retry is accepted, so a lamp still reading
    // "1 dead-lettered" after the interaction can only mean the list was never
    // refetched — which is exactly the defect. No fake timer is advanced here,
    // so the ~5s poll cannot heal it for us.
    let retried = false;

    function delivery() {
      return {
        id: deliveryId,
        endpointId: "77777777-7777-7777-7777-777777777777",
        endpointName: "Orders webhook",
        endpointUrl: "https://example.com/hook",
        status: retried ? "pending" : "dead_lettered",
        attemptCount: 2,
        lastStatusCode: 503,
        lastDurationMs: 42,
        lastError: "service unavailable",
        updatedAt: "2026-08-10T12:00:00.000Z",
      };
    }

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
              {
                id: broadcastId,
                channelId: CHANNEL_ID,
                receivedAt: "2026-08-10T12:00:00.000Z",
                bodyPreview: "hello-world",
                fanout: retried
                  ? { total: 1, succeeded: 0, failed: 0, deadLettered: 0, pending: 1 }
                  : { total: 1, succeeded: 0, failed: 0, deadLettered: 1, pending: 0 },
              },
            ],
            nextCursor: null,
          }),
        );
      }
      if (path === `/channels/${CHANNEL_ID}/broadcasts/${broadcastId}` && method === "GET") {
        return Promise.resolve(
          jsonResponse(200, {
            id: broadcastId,
            channelId: CHANNEL_ID,
            receivedAt: "2026-08-10T12:00:00.000Z",
            contentType: "application/json",
            body: "hello-world",
            deliveries: [delivery()],
          }),
        );
      }
      if (path === `/deliveries/${deliveryId}/attempts` && method === "GET") {
        return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
      }
      if (path === `/deliveries/${deliveryId}/retry` && method === "POST") {
        retried = true;
        return Promise.resolve(jsonResponse(200, delivery()));
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("link", { name: "Activity" }));
    fireEvent.click(await screen.findByText("hello-world"));
    expect(await screen.findByText("1 dead-lettered, 0/1 succeeded")).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: /Orders webhook/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

    // The child reads `pending` and the parent lamp agrees, in one interaction.
    expect(await screen.findByText("pending")).toBeTruthy();
    expect(await screen.findByText("1 pending, 0/1 succeeded")).toBeTruthy();
    expect(screen.queryByText("1 dead-lettered, 0/1 succeeded")).toBeNull();
  });

  it("polls Activity every ~5s", async () => {
    // shouldAdvanceTime: react-router's location subscription schedules through
    // the same low-priority scheduler React uses, which needs real time to tick
    // for the initial fetch to land before we assert on it (issue #42).
    vi.useFakeTimers({ shouldAdvanceTime: true });

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
    // The Channel query settles before the Activity tab (and its own Broadcast
    // query) mounts, so wait for that chain rather than assuming one flush
    // covers both query cycles.
    await waitFor(() => {
      expect(broadcastListCalls(fetchMock)).toBe(1);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FRESHNESS_POLL_MS);
    });
    expect(broadcastListCalls(fetchMock)).toBe(2);
  });

  it("shows a Retry control when Activity fails to load", async () => {
    let shouldFail = true;

    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);

      if (path === `/channels/${CHANNEL_ID}` && method === "GET") {
        return Promise.resolve(jsonResponse(200, baseChannel()));
      }
      if (path === `/channels/${CHANNEL_ID}/broadcasts` && method === "GET") {
        if (shouldFail) {
          return Promise.resolve(jsonResponse(500, { error: { message: "server down" } }));
        }
        return Promise.resolve(
          jsonResponse(200, {
            items: [
              {
                id: "22222222-2222-2222-2222-222222222222",
                channelId: CHANNEL_ID,
                receivedAt: "2026-08-10T12:00:00.000Z",
                bodyPreview: "recovered",
                fanout: { total: 0, succeeded: 0, failed: 0, deadLettered: 0, pending: 0 },
              },
            ],
            nextCursor: null,
          }),
        );
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    renderRoutes(`/channels/${CHANNEL_ID}`);

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();

    shouldFail = false;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await Promise.resolve();
    });

    expect(await screen.findByText("recovered")).toBeTruthy();
  });

  it("polls Broadcast detail while expanded", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const broadcastId = "44444444-4444-4444-4444-444444444444";
    let detailCalls = 0;

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
              {
                id: broadcastId,
                channelId: CHANNEL_ID,
                receivedAt: "2026-08-10T12:00:00.000Z",
                bodyPreview: "hello-world",
                fanout: { total: 0, succeeded: 0, failed: 0, deadLettered: 0, pending: 0 },
              },
            ],
            nextCursor: null,
          }),
        );
      }
      if (path === `/channels/${CHANNEL_ID}/broadcasts/${broadcastId}` && method === "GET") {
        detailCalls += 1;
        return Promise.resolve(
          jsonResponse(200, {
            id: broadcastId,
            channelId: CHANNEL_ID,
            receivedAt: "2026-08-10T12:00:00.000Z",
            contentType: "application/json",
            body: "hello-world",
            deliveries: [],
          }),
        );
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    renderRoutes(`/channels/${CHANNEL_ID}`);
    fireEvent.click(await screen.findByText("hello-world"));
    await flushAsync();
    expect(detailCalls).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FRESHNESS_POLL_MS);
    });
    expect(detailCalls).toBe(2);
  });

  it("clears a failed 'load more' once the ~5s Activity poll succeeds again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let cursorPageFails = true;

    const firstPage = {
      items: [
        {
          id: "22222222-2222-2222-2222-222222222222",
          channelId: CHANNEL_ID,
          receivedAt: "2026-08-10T12:00:00.000Z",
          bodyPreview: "hello-world",
          fanout: { total: 0, succeeded: 0, failed: 0, deadLettered: 0, pending: 0 },
        },
      ],
      nextCursor: "cursor-1",
    };

    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);
      const cursor = new URL(requestUrl(input), "http://localhost").searchParams.get("cursor");

      if (path === `/channels/${CHANNEL_ID}` && method === "GET") {
        return Promise.resolve(jsonResponse(200, baseChannel()));
      }
      if (path === `/channels/${CHANNEL_ID}/broadcasts` && method === "GET") {
        if (cursor === null) {
          return Promise.resolve(jsonResponse(200, firstPage));
        }
        if (cursorPageFails) {
          // Shaped like the real `internal_error` envelope (`app.ts`'s catch-all):
          // an unhandled crash, so the operator sees the domain fallback below
          // (issue #58) rather than this server-internal string verbatim.
          return Promise.resolve(
            jsonResponse(500, {
              error: { code: "internal_error", message: "page two exploded" },
            }),
          );
        }
        return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    renderRoutes(`/channels/${CHANNEL_ID}`);
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));

    // Not "page two exploded" verbatim: an `internal_error` never authored a
    // message worth repeating, so the operator gets the domain sentence plus the
    // one part of an unhandled failure they can act on — the status (issue #58).
    const banner = (await screen.findByRole("alert")).textContent;
    expect(banner).toContain("Failed to load more Activity (HTTP 500)");
    expect(banner).not.toContain("page two exploded");

    // The polled first page still loads fine, so the stale load-more banner goes.
    cursorPageFails = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FRESHNESS_POLL_MS);
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("ChannelDetailPage — Settings delete flow (issue #33)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    stubFetchMock(fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("soft-deletes a Channel with confirmation, then returns to the directory route (issue #33, #42)", async () => {
    let deleteCalled = false;

    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);

      if (path === `/channels/${CHANNEL_ID}` && method === "GET") {
        return Promise.resolve(jsonResponse(200, baseChannel()));
      }
      if (path === `/channels` && method === "GET") {
        return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
      }
      if (path === `/channels/${CHANNEL_ID}/broadcasts` && method === "GET") {
        return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
      }
      if (path === `/channels/${CHANNEL_ID}` && method === "DELETE") {
        deleteCalled = true;
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    renderRoutes(`/channels/${CHANNEL_ID}`);

    // Navigate to Settings tab
    fireEvent.click(await screen.findByRole("link", { name: "Settings" }));

    // Delete Channel button should be visible
    const deleteButton = await screen.findByRole("button", { name: "Delete Channel" });
    expect(deleteButton).toBeTruthy();

    // Click Delete Channel, which shows confirmation
    fireEvent.click(deleteButton);

    // The first click only asks for confirmation — it must not delete anything yet.
    const confirmButton = await screen.findByRole("button", { name: "Confirm delete" });
    expect(await screen.findByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(deleteCalled).toBe(false);

    fireEvent.click(confirmButton);

    // Wait for the delete API call and navigation back to the directory route.
    await waitFor(() => {
      expect(deleteCalled).toBe(true);
    });
    expect(await screen.findByText("New Channel")).toBeTruthy();
  });

  it("keeps the operator on the Channel and surfaces the error when delete fails (issue #33)", async () => {
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);

      if (path === `/channels/${CHANNEL_ID}` && method === "GET") {
        return Promise.resolve(jsonResponse(200, baseChannel()));
      }
      if (path === `/channels/${CHANNEL_ID}/broadcasts` && method === "GET") {
        return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
      }
      if (path === `/channels/${CHANNEL_ID}` && method === "DELETE") {
        return Promise.resolve(
          jsonResponse(500, { error: { code: "internal_error", message: "delete exploded" } }),
        );
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("link", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete Channel" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm delete" }));

    // The failure is reported next to the control that failed, and no navigation happens.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Failed to delete Channel (HTTP 500)");
    expect(alert.textContent).not.toContain("delete exploded");
    expect(screen.queryByText("New Channel")).toBeNull();

    // The operator can retry: the confirm control is live again, not stuck on "Deleting…".
    expect(screen.getByRole("button", { name: "Confirm delete" })).toBeTruthy();
  });

  it("allows canceling the delete confirmation (issue #33)", async () => {
    let deleteCalled = false;

    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);

      if (path === `/channels/${CHANNEL_ID}` && method === "GET") {
        return Promise.resolve(jsonResponse(200, baseChannel()));
      }
      if (path === `/channels/${CHANNEL_ID}/broadcasts` && method === "GET") {
        return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
      }
      if (path === `/channels/${CHANNEL_ID}` && method === "DELETE") {
        deleteCalled = true;
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("link", { name: "Settings" }));

    // Open delete confirmation
    fireEvent.click(await screen.findByRole("button", { name: "Delete Channel" }));

    // Cancel the delete
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    // Back to the resting state, with nothing deleted and no navigation.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Delete Channel" })).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "Confirm delete" })).toBeNull();
    expect(deleteCalled).toBe(false);
    expect(screen.queryByText("New Channel")).toBeNull();

    // Cancelling returns focus to the exact trigger that opened the region
    // (issue #61), not wherever the browser defaults to once it unmounts.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Delete Channel" }));
  });

  it("moves focus into the delete confirm region on open and closes it on Escape", async () => {
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

    fireEvent.click(await screen.findByRole("link", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete Channel" }));

    // The overlay focus contract (DESIGN.md #4): the button just clicked is
    // gone, replaced by the confirm region, so focus is moved deliberately
    // rather than left on <body>.
    const confirmButton = await screen.findByRole("button", { name: "Confirm delete" });
    expect(document.activeElement).toBe(confirmButton);

    const region = confirmButton.closest('[role="group"]')!;
    expect(region.getAttribute("aria-label")).toMatch(/orders/);

    fireEvent.keyDown(confirmButton, { key: "Escape" });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Delete Channel" })).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "Confirm delete" })).toBeNull();
    // Escape returns focus to the same trigger a Cancel click would.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Delete Channel" }));
  });

  it("keeps the enabled toggle distinct from delete (issue #33)", async () => {
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

    fireEvent.click(await screen.findByRole("link", { name: "Settings" }));

    // Toggling `enabled` is a separate, reversible control and never arms the delete confirmation.
    const enabledToggle = await screen.findByLabelText("Enabled");
    fireEvent.click(enabledToggle);

    expect(screen.queryByRole("button", { name: "Confirm delete" })).toBeNull();
    expect(screen.getByRole("button", { name: "Delete Channel" })).toBeTruthy();
  });
});

describe("ChannelDetailPage — Settings channel disable guard (issue #46)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    stubFetchMock(fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows warning when disabling a Channel with enabled Endpoints", async () => {
    const enabledEndpointId = "66666666-6666-6666-6666-666666666666";
    const disabledEndpointId = "77777777-7777-7777-7777-777777777777";

    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);

      if (path === `/channels/${CHANNEL_ID}` && method === "GET") {
        return Promise.resolve(jsonResponse(200, baseChannel()));
      }
      if (path === `/channels/${CHANNEL_ID}/broadcasts` && method === "GET") {
        return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
      }
      if (path === `/channels/${CHANNEL_ID}/endpoints` && method === "GET") {
        return Promise.resolve(
          jsonResponse(200, {
            items: [
              {
                id: enabledEndpointId,
                channelId: CHANNEL_ID,
                name: "webhook-1",
                url: "https://example.com/webhook",
                timeoutMs: null,
                headers: {},
                enabled: true,
                createdAt: "2026-08-10T00:00:00.000Z",
                updatedAt: "2026-08-10T00:00:00.000Z",
              },
              {
                id: disabledEndpointId,
                channelId: CHANNEL_ID,
                name: "webhook-2",
                url: "https://example.com/webhook2",
                timeoutMs: null,
                headers: {},
                enabled: false,
                createdAt: "2026-08-10T00:00:00.000Z",
                updatedAt: "2026-08-10T00:00:00.000Z",
              },
            ],
            nextCursor: null,
          }),
        );
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("link", { name: "Settings" }));

    // Initially, no warning (channel is enabled)
    expect(screen.queryByText(/Disabling this Channel stops fan-out/)).toBeNull();

    // Disable the channel
    const enabledToggle = await screen.findByLabelText("Enabled");
    fireEvent.click(enabledToggle);

    // Warning appears showing count of enabled Endpoints
    const warning = await screen.findByText(
      /Disabling this Channel stops fan-out to 1 enabled Endpoint/,
    );
    expect(warning).toBeTruthy();

    // It is a consequence advisory, not a failure (issue #67): no Lamp Cut and
    // no assertive live region, since visibility tracks the switch the operator
    // is toggling.
    const advisory = warning.closest("p")!;
    expect(advisory.className).toContain("advisory");
    expect(advisory.className).not.toContain("error-text");
    expect(advisory.getAttribute("role")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows correct plural when disabling Channel with multiple enabled Endpoints", async () => {
    const endpoint1Id = "66666666-6666-6666-6666-666666666666";
    const endpoint2Id = "77777777-7777-7777-7777-777777777777";

    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);

      if (path === `/channels/${CHANNEL_ID}` && method === "GET") {
        return Promise.resolve(jsonResponse(200, baseChannel()));
      }
      if (path === `/channels/${CHANNEL_ID}/broadcasts` && method === "GET") {
        return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
      }
      if (path === `/channels/${CHANNEL_ID}/endpoints` && method === "GET") {
        return Promise.resolve(
          jsonResponse(200, {
            items: [
              {
                id: endpoint1Id,
                channelId: CHANNEL_ID,
                name: "webhook-1",
                url: "https://example.com/webhook1",
                timeoutMs: null,
                headers: {},
                enabled: true,
                createdAt: "2026-08-10T00:00:00.000Z",
                updatedAt: "2026-08-10T00:00:00.000Z",
              },
              {
                id: endpoint2Id,
                channelId: CHANNEL_ID,
                name: "webhook-2",
                url: "https://example.com/webhook2",
                timeoutMs: null,
                headers: {},
                enabled: true,
                createdAt: "2026-08-10T00:00:00.000Z",
                updatedAt: "2026-08-10T00:00:00.000Z",
              },
            ],
            nextCursor: null,
          }),
        );
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("link", { name: "Settings" }));

    // Disable the channel
    const enabledToggle = await screen.findByLabelText("Enabled");
    fireEvent.click(enabledToggle);

    // Warning shows plural Endpoints
    expect(
      await screen.findByText(/Disabling this Channel stops fan-out to 2 enabled Endpoints/),
    ).toBeTruthy();
  });

  it("does not show warning when disabling Channel with no enabled Endpoints", async () => {
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);

      if (path === `/channels/${CHANNEL_ID}` && method === "GET") {
        return Promise.resolve(jsonResponse(200, baseChannel()));
      }
      if (path === `/channels/${CHANNEL_ID}/broadcasts` && method === "GET") {
        return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
      }
      if (path === `/channels/${CHANNEL_ID}/endpoints` && method === "GET") {
        return Promise.resolve(
          jsonResponse(200, {
            items: [
              {
                id: "88888888-8888-8888-8888-888888888888",
                channelId: CHANNEL_ID,
                name: "webhook-1",
                url: "https://example.com/webhook",
                timeoutMs: null,
                headers: {},
                enabled: false,
                createdAt: "2026-08-10T00:00:00.000Z",
                updatedAt: "2026-08-10T00:00:00.000Z",
              },
            ],
            nextCursor: null,
          }),
        );
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("link", { name: "Settings" }));

    // Disable the channel
    const enabledToggle = await screen.findByLabelText("Enabled");
    await flushAsync();
    fireEvent.click(enabledToggle);
    await flushAsync();

    // No warning when there are no enabled Endpoints
    expect(screen.queryByText(/Disabling this Channel stops fan-out/)).toBeNull();
  });

  it("does not show warning when re-enabling a Channel", async () => {
    const baseChannelDisabled = {
      id: CHANNEL_ID,
      slug: "orders",
      description: "Order events",
      enabled: false,
      endpointCount: 1,
      hasBroadcasts: true,
      recentFailedDeliveryCount: 0,
      autoDisabledEndpointCount: 0,
      tokens: [],
      deletedAt: null,
      createdAt: "2026-08-10T00:00:00.000Z",
      updatedAt: "2026-08-10T00:00:00.000Z",
    };

    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);

      if (path === `/channels/${CHANNEL_ID}` && method === "GET") {
        return Promise.resolve(jsonResponse(200, baseChannelDisabled));
      }
      if (path === `/channels/${CHANNEL_ID}/broadcasts` && method === "GET") {
        return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
      }
      if (path === `/channels/${CHANNEL_ID}/endpoints` && method === "GET") {
        return Promise.resolve(
          jsonResponse(200, {
            items: [
              {
                id: "88888888-8888-8888-8888-888888888888",
                channelId: CHANNEL_ID,
                name: "webhook-1",
                url: "https://example.com/webhook",
                timeoutMs: null,
                headers: {},
                enabled: true,
                createdAt: "2026-08-10T00:00:00.000Z",
                updatedAt: "2026-08-10T00:00:00.000Z",
              },
            ],
            nextCursor: null,
          }),
        );
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("link", { name: "Settings" }));

    // Re-enable the channel
    const enabledToggle = await screen.findByLabelText("Enabled");
    await flushAsync();
    fireEvent.click(enabledToggle);

    // No warning when enabling (only destructive direction is guarded)
    expect(screen.queryByText(/Disabling this Channel stops fan-out/)).toBeNull();

    // Unchecking again returns to the Channel's saved state, so no fan-out is being stopped
    // and there is still nothing to warn about.
    fireEvent.click(enabledToggle);
    await flushAsync();
    expect(screen.queryByText(/Disabling this Channel stops fan-out/)).toBeNull();
  });
});

describe("ChannelDetailPage — Destructive at rest (issue #80)", () => {
  const TOKEN_ID = "88888888-8888-8888-8888-888888888888";
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    stubFetchMock(fetchMock);
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);

      if (path === `/channels/${CHANNEL_ID}` && method === "GET") {
        return Promise.resolve(
          jsonResponse(
            200,
            baseChannel([
              { id: TOKEN_ID, prefix: "wbt_abcd1234", createdAt: "2026-08-10T12:00:00.000Z" },
            ]),
          ),
        );
      }
      if (path === `/channels/${CHANNEL_ID}/broadcasts` && method === "GET") {
        return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
      }
      if (path === `/channels/${CHANNEL_ID}/endpoints` && method === "GET") {
        return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  // DESIGN.md §5 "Destructive at rest": an irreversible control says so before the
  // press, not only in the confirm region that follows it. These assert the class
  // because the treatment is entirely visual — nothing else observable would fail
  // if a future edit dropped it back to a plain `.control`.
  it("gives the resting Delete Channel and Revoke triggers the destructive treatment", async () => {
    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("link", { name: "Settings" }));

    const deleteTrigger = await screen.findByRole("button", { name: "Delete Channel" });
    expect(deleteTrigger.className).toContain("control-destructive");

    const revokeTrigger = await screen.findByRole("button", { name: "Revoke" });
    expect(revokeTrigger.className).toContain("control-destructive");
  });

  // The treatment is a signal added *before* the press; it does not replace the
  // guard after it, and it does not restyle that guard's own commit button.
  it("leaves the confirm regions on the Commit treatment", async () => {
    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("link", { name: "Settings" }));

    fireEvent.click(await screen.findByRole("button", { name: "Delete Channel" }));
    const confirmDelete = await screen.findByRole("button", { name: "Confirm delete" });
    expect(confirmDelete.className).toContain("control-commit");
    expect(confirmDelete.className).not.toContain("control-destructive");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
    const confirmRevoke = await screen.findByRole("button", { name: "Confirm revoke" });
    expect(confirmRevoke.className).toContain("control-commit");
    expect(confirmRevoke.className).not.toContain("control-destructive");
  });

  // The Quarantine Rule forbids a lamp color on a control; the treatment must not
  // smuggle one in via a status/tone class.
  it("does not reach for a lamp tone on the destructive controls", async () => {
    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("link", { name: "Settings" }));

    for (const name of ["Delete Channel", "Revoke"]) {
      const trigger = await screen.findByRole("button", { name });
      expect(trigger.className).not.toMatch(/\b(lamp|tone-|is-danger|danger)\b/);
    }
  });
});
