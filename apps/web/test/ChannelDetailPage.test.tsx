// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelDetailPage } from "../src/pages/ChannelDetailPage.js";
import { FRESHNESS_POLL_MS } from "../src/lib/freshness.js";
import { requestMethod, requestPath, stubFetchMock } from "./fetchMock.js";

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

    render(<ChannelDetailPage channelId={CHANNEL_ID} onBack={() => undefined} />);

    fireEvent.click(await screen.findByRole("button", { name: "Activity" }));

    expect(await screen.findByText("hello-world")).toBeTruthy();
    expect(screen.getByText("no Endpoints yet")).toBeTruthy();
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

    render(<ChannelDetailPage channelId={CHANNEL_ID} onBack={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "Activity" }));

    expect(await screen.findByText(/No Broadcasts yet/)).toBeTruthy();
  });

  it("mints an ingest token, shows the plaintext once, and revoke removes it from the list", async () => {
    const tokenId = "33333333-3333-3333-3333-333333333333";
    let mintedOnServer = false;

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
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    render(<ChannelDetailPage channelId={CHANNEL_ID} onBack={() => undefined} />);

    // Default hub tab is Activity (ADR 0004); tokens live under Settings.
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Mint new token" }));

    expect(await screen.findByText(/wbt_abcd1234-plaintext-secret/)).toBeTruthy();
    expect(await screen.findByText("wbt_abcd1234…")).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));

    await waitFor(() => {
      expect(screen.queryByText("wbt_abcd1234…")).toBeNull();
    });
  });

  it("replays a Broadcast from its detail panel (issue #22)", async () => {
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
      if (
        path === `/channels/${CHANNEL_ID}/broadcasts/${broadcastId}/replay` &&
        method === "POST"
      ) {
        replayCalled = true;
        return Promise.resolve(jsonResponse(202, { id: replayId }));
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    render(<ChannelDetailPage channelId={CHANNEL_ID} onBack={() => undefined} />);

    fireEvent.click(await screen.findByRole("button", { name: "Activity" }));
    fireEvent.click(await screen.findByText("hello-world"));
    fireEvent.click(await screen.findByRole("button", { name: "Replay" }));

    await waitFor(() => {
      expect(replayCalled).toBe(true);
    });
    expect(await screen.findByText(/Replayed/)).toBeTruthy();
  });

  it("polls Activity every ~5s", async () => {
    vi.useFakeTimers();

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

    render(<ChannelDetailPage channelId={CHANNEL_ID} onBack={() => undefined} />);
    await flushAsync();
    expect(broadcastListCalls(fetchMock)).toBe(1);

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

    render(<ChannelDetailPage channelId={CHANNEL_ID} onBack={() => undefined} />);

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

    render(<ChannelDetailPage channelId={CHANNEL_ID} onBack={() => undefined} />);
    fireEvent.click(await screen.findByText("hello-world"));
    await flushAsync();
    expect(detailCalls).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FRESHNESS_POLL_MS);
    });
    expect(detailCalls).toBe(2);
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

  it("soft-deletes a Channel with confirmation, then returns to directory (issue #33)", async () => {
    let deleteCalled = false;
    const onBack = vi.fn();

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

    render(<ChannelDetailPage channelId={CHANNEL_ID} onBack={onBack} />);

    // Navigate to Settings tab
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));

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

    // Wait for the delete API call and navigation
    await waitFor(() => {
      expect(deleteCalled).toBe(true);
      expect(onBack).toHaveBeenCalled();
    });
  });

  it("keeps the operator on the Channel and surfaces the error when delete fails (issue #33)", async () => {
    const onBack = vi.fn();

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
          jsonResponse(500, { error: { code: "internal", message: "delete exploded" } }),
        );
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    render(<ChannelDetailPage channelId={CHANNEL_ID} onBack={onBack} />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete Channel" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm delete" }));

    // The failure is reported next to the control that failed, and no navigation happens.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("delete exploded");
    expect(onBack).not.toHaveBeenCalled();

    // The operator can retry: the confirm control is live again, not stuck on "Deleting…".
    expect(screen.getByRole("button", { name: "Confirm delete" })).toBeTruthy();
  });

  it("allows canceling the delete confirmation (issue #33)", async () => {
    let deleteCalled = false;
    const onBack = vi.fn();

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

    render(<ChannelDetailPage channelId={CHANNEL_ID} onBack={onBack} />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));

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
    expect(onBack).not.toHaveBeenCalled();
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

    render(<ChannelDetailPage channelId={CHANNEL_ID} onBack={() => undefined} />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));

    // Toggling `enabled` is a separate, reversible control and never arms the delete confirmation.
    const enabledToggle = await screen.findByLabelText("Enabled");
    fireEvent.click(enabledToggle);

    expect(screen.queryByRole("button", { name: "Confirm delete" })).toBeNull();
    expect(screen.getByRole("button", { name: "Delete Channel" })).toBeTruthy();
  });
});
