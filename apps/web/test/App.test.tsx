// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { FRESHNESS_POLL_MS } from "../src/lib/freshness.js";
import { requestMethod, requestPath, stubFetchMock } from "./fetchMock.js";

function jsonResponse(status: number, body: unknown, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function channelSummary(id: string) {
  return {
    id,
    slug: "orders",
    description: "Order events",
    enabled: true,
    endpointCount: 2,
    tokens: [],
    deletedAt: null,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
  };
}

function channelDetailFetches(
  channelId: string,
  extra: (path: string, method: string) => Response | null = () => null,
) {
  return (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const path = requestPath(input);
    const method = requestMethod(input, init);

    const custom = extra(path, method);
    if (custom) {
      return Promise.resolve(custom);
    }
    if (path === "/auth/session") {
      return Promise.resolve(jsonResponse(200, { ok: true }));
    }
    if (path === "/channels" && method === "GET") {
      return Promise.resolve(
        jsonResponse(200, { items: [channelSummary(channelId)], nextCursor: null }),
      );
    }
    if (path === `/channels/${channelId}` && method === "GET") {
      return Promise.resolve(jsonResponse(200, channelSummary(channelId)));
    }
    if (path === `/channels/${channelId}/broadcasts` && method === "GET") {
      return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
    }
    if (path === `/channels/${channelId}/endpoints` && method === "GET") {
      return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
    }
    throw new Error(`unexpected fetch: ${method} ${path}`);
  };
}

describe("dashboard smoke flow", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Each test starts from a clean address bar — the app owns the real URL (issue #42).
    window.history.pushState({}, "", "/");
    fetchMock = vi.fn();
    stubFetchMock(fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the login form when there is no session", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { code: "unauthorized", message: "no session" } }),
    );

    render(<App />);

    expect(await screen.findByLabelText("Operator API key")).toBeTruthy();
  });

  it("logs in, then shows the Channel directory populated from the API", async () => {
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);

      if (path === "/auth/session") {
        return Promise.resolve(
          jsonResponse(401, { error: { code: "unauthorized", message: "no session" } }),
        );
      }
      if (path === "/auth/login" && method === "POST") {
        return Promise.resolve(jsonResponse(200, { ok: true }));
      }
      if (path === "/channels" && method === "GET") {
        return Promise.resolve(
          jsonResponse(200, {
            items: [
              {
                id: "11111111-1111-1111-1111-111111111111",
                slug: "orders",
                description: "Order events",
                enabled: true,
                endpointCount: 2,
                tokens: [],
                deletedAt: null,
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

    render(<App />);

    const apiKeyInput = await screen.findByLabelText("Operator API key");
    fireEvent.change(apiKeyInput, { target: { value: "test-operator-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("orders")).toBeTruthy();
    expect(screen.getByText("2 Endpoints")).toBeTruthy();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/auth/login",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  // Issue #33: the soft-delete must land the operator back on the directory with the Channel gone
  // from the normal listing. The API already filters `deletedAt`; this pins the UI half of that.
  it("soft-deletes a Channel from Settings and returns to a directory without it", async () => {
    const channelId = "11111111-1111-1111-1111-111111111111";
    let deleted = false;

    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);

      if (path === "/auth/session") {
        return Promise.resolve(jsonResponse(200, { ok: true }));
      }
      if (path === "/channels" && method === "GET") {
        // Mirrors the API's `isNull(deletedAt)` filter on the Channel list.
        return Promise.resolve(
          jsonResponse(200, {
            items: deleted ? [] : [channelSummary(channelId)],
            nextCursor: null,
          }),
        );
      }
      if (path === `/channels/${channelId}` && method === "GET") {
        return Promise.resolve(jsonResponse(200, channelSummary(channelId)));
      }
      if (path === `/channels/${channelId}/broadcasts` && method === "GET") {
        return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
      }
      if (path === `/channels/${channelId}` && method === "DELETE") {
        deleted = true;
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    render(<App />);

    fireEvent.click(await screen.findByText("orders"));
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete Channel" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm delete" }));

    // Back on the directory, and the soft-deleted Channel is gone from the normal listing.
    expect(await screen.findByText("New Channel")).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByText("orders")).toBeNull();
    });
  });

  // Issue #42: Channel, tab, and expanded Broadcast all live in the address bar.
  it("gives the Channel its own URL and updates the document title for the directory and the Channel", async () => {
    const channelId = "11111111-1111-1111-1111-111111111111";
    fetchMock.mockImplementation(channelDetailFetches(channelId));

    render(<App />);
    expect(await screen.findByText("New Channel")).toBeTruthy();
    expect(document.title).toBe("Channels · webhook-broadcast");

    fireEvent.click(await screen.findByText("orders"));

    await waitFor(() => {
      expect(window.location.pathname).toBe(`/channels/${channelId}`);
    });
    await waitFor(() => {
      expect(document.title).toBe("orders · Activity · webhook-broadcast");
    });
  });

  it("puts the active tab in the URL, and opening a tab link lands directly on that tab", async () => {
    const channelId = "11111111-1111-1111-1111-111111111111";
    fetchMock.mockImplementation(channelDetailFetches(channelId));

    // Opening a link straight to the Endpoints tab lands there without a directory detour.
    window.history.pushState({}, "", `/channels/${channelId}/endpoints`);
    render(<App />);

    expect(await screen.findByRole("button", { name: "Endpoints" })).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Endpoints" }).className).toContain("tab-active");
    });
    await waitFor(() => {
      expect(document.title).toBe("orders · Endpoints · webhook-broadcast");
    });

    // Switching tabs updates the address and the title together.
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    await waitFor(() => {
      expect(window.location.pathname).toBe(`/channels/${channelId}/settings`);
    });
    expect(document.title).toBe("orders · Settings · webhook-broadcast");
  });

  it("keeps the expanded Broadcast in the URL, surviving a reload", async () => {
    const channelId = "11111111-1111-1111-1111-111111111111";
    const broadcastId = "22222222-2222-2222-2222-222222222222";

    fetchMock.mockImplementation(
      channelDetailFetches(channelId, (path, method) => {
        if (path === `/channels/${channelId}/broadcasts` && method === "GET") {
          return jsonResponse(200, {
            items: [
              {
                id: broadcastId,
                channelId,
                receivedAt: "2026-08-10T12:00:00.000Z",
                bodyPreview: "hello-world",
                fanout: { total: 0, succeeded: 0, failed: 0, deadLettered: 0, pending: 0 },
              },
            ],
            nextCursor: null,
          });
        }
        if (path === `/channels/${channelId}/broadcasts/${broadcastId}` && method === "GET") {
          return jsonResponse(200, {
            id: broadcastId,
            channelId,
            receivedAt: "2026-08-10T12:00:00.000Z",
            contentType: "application/json",
            body: "hello-world",
            deliveries: [],
          });
        }
        return null;
      }),
    );

    render(<App />);
    fireEvent.click(await screen.findByText("orders"));
    fireEvent.click(await screen.findByText("hello-world"));

    await waitFor(() => {
      expect(window.location.pathname).toBe(`/channels/${channelId}/activity/${broadcastId}`);
    });
    expect(await screen.findByText(/hello-world/)).toBeTruthy();

    // Reload: re-mounting the app at the same URL restores the same expanded Broadcast.
    cleanup();
    render(<App />);
    expect(await screen.findByRole("button", { name: /hello-world/ })).toBeTruthy();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /hello-world/ }).getAttribute("aria-expanded"),
      ).toBe("true");
    });
  });

  it("moves Back and Forward through Channel and tab navigation", async () => {
    const channelId = "11111111-1111-1111-1111-111111111111";
    fetchMock.mockImplementation(channelDetailFetches(channelId));

    render(<App />);
    expect(await screen.findByText("New Channel")).toBeTruthy();

    fireEvent.click(await screen.findByText("orders"));
    await waitFor(() => {
      expect(window.location.pathname).toBe(`/channels/${channelId}`);
    });

    fireEvent.click(await screen.findByRole("button", { name: "Endpoints" }));
    await waitFor(() => {
      expect(window.location.pathname).toBe(`/channels/${channelId}/endpoints`);
    });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    await waitFor(() => {
      expect(window.location.pathname).toBe(`/channels/${channelId}/settings`);
    });

    await act(async () => {
      window.history.back();
    });
    await waitFor(() => {
      expect(window.location.pathname).toBe(`/channels/${channelId}/endpoints`);
    });

    await act(async () => {
      window.history.back();
    });
    await waitFor(() => {
      expect(window.location.pathname).toBe(`/channels/${channelId}`);
    });

    await act(async () => {
      window.history.forward();
    });
    await waitFor(() => {
      expect(window.location.pathname).toBe(`/channels/${channelId}/endpoints`);
    });
  });

  it("shows an inline not-found message with a link back to the directory for an unknown Channel id", async () => {
    const missingId = "99999999-9999-9999-9999-999999999999";

    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);

      if (path === "/auth/session") {
        return Promise.resolve(jsonResponse(200, { ok: true }));
      }
      if (path === `/channels/${missingId}` && method === "GET") {
        return Promise.resolve(
          jsonResponse(404, { error: { code: "not_found", message: "channel not found" } }),
        );
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    window.history.pushState({}, "", `/channels/${missingId}`);
    render(<App />);

    const message = await screen.findByRole("alert");
    expect(message.textContent?.toLowerCase()).toContain("not found");
    expect(message.textContent?.toLowerCase()).not.toContain("oops");

    const backLink = screen.getByRole("link", { name: /Back to Channels/i });
    fireEvent.click(backLink);

    expect(await screen.findByText("New Channel")).toBeTruthy();
    await waitFor(() => {
      expect(window.location.pathname).toBe("/");
    });
  });

  it("logging out returns to the directory route and clears the session", async () => {
    const channelId = "11111111-1111-1111-1111-111111111111";
    let loggedOut = false;

    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);

      if (path === "/auth/session") {
        return Promise.resolve(
          loggedOut
            ? jsonResponse(401, { error: { code: "unauthorized", message: "no session" } })
            : jsonResponse(200, { ok: true }),
        );
      }
      if (path === "/auth/logout" && method === "POST") {
        loggedOut = true;
        return Promise.resolve(jsonResponse(200, { ok: true }));
      }
      if (path === `/channels/${channelId}` && method === "GET") {
        return Promise.resolve(jsonResponse(200, channelSummary(channelId)));
      }
      if (path === `/channels/${channelId}/broadcasts` && method === "GET") {
        return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    window.history.pushState({}, "", `/channels/${channelId}`);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Log out" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/auth/logout",
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(await screen.findByLabelText("Operator API key")).toBeTruthy();
    expect(window.location.pathname).toBe("/");
  });

  it("renders an inline not-found for a URL that matches no route, instead of an empty shell", async () => {
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);

      if (path === "/auth/session") {
        return Promise.resolve(jsonResponse(200, { ok: true }));
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    // "/channels" has no :channelId, so it matches neither route.
    window.history.pushState({}, "", "/channels");
    render(<App />);

    const message = await screen.findByRole("alert");
    expect(message.textContent?.toLowerCase()).toContain("does not match any view");
    expect(message.textContent?.toLowerCase()).not.toContain("oops");
    expect(document.title).toBe("Page not found · webhook-broadcast");

    fireEvent.click(screen.getByRole("link", { name: /Back to Channels/i }));
    expect(await screen.findByText("New Channel")).toBeTruthy();
  });

  it("stops polling a Channel id the admin API reports as not found", async () => {
    const missingId = "99999999-9999-9999-9999-999999999999";
    let detailRequests = 0;

    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);

      if (path === "/auth/session") {
        return Promise.resolve(jsonResponse(200, { ok: true }));
      }
      if (path === `/channels/${missingId}` && method === "GET") {
        detailRequests += 1;
        return Promise.resolve(
          jsonResponse(404, { error: { code: "not_found", message: "channel not found" } }),
        );
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      window.history.pushState({}, "", `/channels/${missingId}`);
      render(<App />);
      await screen.findByRole("alert");

      const afterFirstLoad = detailRequests;
      // Well past several ~5s ADR 0004 poll intervals: a 404 is terminal, so the
      // view must not keep re-requesting a Channel that is gone.
      await vi.advanceTimersByTimeAsync(FRESHNESS_POLL_MS * 4);
      expect(detailRequests).toBe(afterFirstLoad);
    } finally {
      vi.useRealTimers();
    }
  });
});
