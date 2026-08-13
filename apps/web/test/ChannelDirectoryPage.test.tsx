// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FRESHNESS_POLL_MS } from "../src/lib/freshness.js";
import { renderRoutes, requestMethod, requestPath, stubFetchMock } from "./fetchMock.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function flushAsync(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

/** A Channel list item with the boring fields filled in, so a case states only what it varies. */
function channelItem(
  overrides: { id: string; slug: string } & Partial<{
    description: string | null;
    enabled: boolean;
    endpointCount: number;
    hasBroadcasts: boolean;
    recentFailedDeliveryCount: number;
    autoDisabledEndpointCount: number;
  }>,
): Record<string, unknown> {
  return {
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
    ...overrides,
  };
}

/** Channel slugs in DOM order — the directory must not re-sort the ranked response. */
function renderedSlugsInOrder(): string[] {
  return Array.from(document.querySelectorAll(".row-name")).map((node) =>
    (node.textContent ?? "").trim(),
  );
}

/** Simulates the tab being backgrounded/foregrounded (jsdom never changes this on its own). */
function setDocumentVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("ChannelDirectoryPage — freshness and retry", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    stubFetchMock(fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    setDocumentVisibility("visible");
  });

  it("polls the Channel list every ~5s", async () => {
    vi.useFakeTimers();

    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);
      if (path === "/channels" && method === "GET") {
        return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    renderRoutes("/");

    await flushAsync();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FRESHNESS_POLL_MS);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("pauses polling while the tab is hidden and refetches once it is visible again", async () => {
    vi.useFakeTimers();

    fetchMock.mockImplementation((input: string | URL | Request) => {
      const path = requestPath(input);
      if (path === "/channels") {
        return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
      }
      throw new Error(`unexpected fetch: ${path}`);
    });

    renderRoutes("/");
    await flushAsync();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    setDocumentVisibility("hidden");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FRESHNESS_POLL_MS * 3);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    setDocumentVisibility("visible");
    await flushAsync();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("surfaces Zod validation details when Channel create fails", async () => {
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);
      if (path === "/channels" && method === "GET") {
        return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
      }
      if (path === "/channels" && method === "POST") {
        return Promise.resolve(
          jsonResponse(400, {
            error: {
              code: "validation_failed",
              message: "invalid channel payload",
              details: [
                {
                  path: "slug",
                  message: "slug must be lowercase kebab-case (a-z, 0-9, -)",
                },
              ],
            },
          }),
        );
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    renderRoutes("/");
    await flushAsync();

    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "UnipileDev" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create Channel" }));
      await Promise.resolve();
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("slug must be lowercase kebab-case (a-z, 0-9, -)");
    expect(alert.textContent).not.toContain("invalid channel payload");
  });

  it("shows a Retry control when loading Channels fails", async () => {
    let shouldFail = true;

    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);
      if (path === "/channels" && method === "GET") {
        if (shouldFail) {
          return Promise.resolve(jsonResponse(500, { error: { message: "server down" } }));
        }
        return Promise.resolve(
          jsonResponse(200, {
            items: [
              {
                id: "11111111-1111-1111-1111-111111111111",
                slug: "orders",
                description: null,
                enabled: true,
                endpointCount: 0,
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

    renderRoutes("/");

    await flushAsync();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();

    shouldFail = false;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await Promise.resolve();
    });

    expect(await screen.findByText("orders")).toBeTruthy();
  });

  it("renders the recent-failure signal on each Channel directory row (issue #44)", async () => {
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);
      if (path === "/channels" && method === "GET") {
        return Promise.resolve(
          jsonResponse(200, {
            items: [
              {
                id: "11111111-1111-1111-1111-111111111111",
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
              },
              {
                id: "22222222-2222-2222-2222-222222222222",
                slug: "invoices",
                description: null,
                enabled: true,
                endpointCount: 1,
                hasBroadcasts: true,
                recentFailedDeliveryCount: 4,
                autoDisabledEndpointCount: 0,
                tokens: [],
                deletedAt: null,
                createdAt: "2026-08-10T00:00:00.000Z",
                updatedAt: "2026-08-10T00:00:00.000Z",
              },
              {
                id: "33333333-3333-3333-3333-333333333333",
                slug: "quiet",
                description: null,
                enabled: true,
                endpointCount: 0,
                hasBroadcasts: false,
                recentFailedDeliveryCount: 0,
                autoDisabledEndpointCount: 0,
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

    renderRoutes("/");
    await flushAsync();

    expect(await screen.findByText("No failures (24h)")).toBeTruthy();
    expect(screen.getByText("4 failing (24h)")).toBeTruthy();
    expect(screen.getByText("No activity")).toBeTruthy();
  });

  it("renders Channel rows unhealthy-first, in the order the API ranked them (issue #45)", async () => {
    // The API ranks by health (`listChannels`' health tier ahead of the
    // `(slug, id)` tie-break), so the directory must render the response order
    // verbatim: no client-side re-sort may put a healthy Channel above one
    // needing attention, and a disabled Channel must stay parked last even
    // though its slug sorts first alphabetically.
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);
      if (path === "/channels" && method === "GET") {
        return Promise.resolve(
          jsonResponse(200, {
            items: [
              channelItem({
                id: "11111111-1111-1111-1111-111111111111",
                slug: "zeta-auto-disabled",
                autoDisabledEndpointCount: 2,
              }),
              channelItem({
                id: "22222222-2222-2222-2222-222222222222",
                slug: "yankee-failing",
                recentFailedDeliveryCount: 4,
              }),
              channelItem({ id: "33333333-3333-3333-3333-333333333333", slug: "healthy" }),
              channelItem({
                id: "44444444-4444-4444-4444-444444444444",
                slug: "alpha-disabled",
                enabled: false,
                recentFailedDeliveryCount: 3,
              }),
            ],
            nextCursor: null,
          }),
        );
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    renderRoutes("/");
    await flushAsync();

    expect(await screen.findByText("zeta-auto-disabled")).toBeTruthy();
    expect(renderedSlugsInOrder()).toEqual([
      "zeta-auto-disabled",
      "yankee-failing",
      "healthy",
      "alpha-disabled",
    ]);

    // The auto-disabled Endpoint count reaches the row itself, not just the API.
    expect(screen.getByText("2 auto-disabled")).toBeTruthy();

    // Disabled is a choice, broken is not: identical-shaped counts, distinct tone.
    expect(screen.getByText("4 failing (24h)").className).toContain("lamp-cut");
    expect(screen.getByText("3 failing (24h)").className).toContain("lamp-neutral");
  });

  it("renders each Channel row as a link carrying its drill-down href (issue #55)", async () => {
    // The row is an anchor, not a button, so cmd-click, middle-click, "open in
    // new tab" and "copy link address" all work and a screen reader announces
    // a link. A real `href` is what carries every one of those behaviours, so
    // the destination is asserted on the attribute rather than by clicking:
    // programmatic navigation would pass a click-based test with a `<button>`
    // again.
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);
      if (path === "/channels" && method === "GET") {
        return Promise.resolve(
          jsonResponse(200, {
            items: [
              channelItem({
                id: "22222222-2222-2222-2222-222222222222",
                slug: "failing",
                recentFailedDeliveryCount: 4,
              }),
              channelItem({ id: "33333333-3333-3333-3333-333333333333", slug: "healthy" }),
            ],
            nextCursor: null,
          }),
        );
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    renderRoutes("/");
    await flushAsync();

    const rows = await screen.findAllByRole("link");
    const hrefs = rows.map((row) => row.getAttribute("href"));

    // The smart drill-down survives the element change: a Channel with recent
    // failures still addresses the failures-filtered Activity view, a healthy
    // one still addresses the Channel itself.
    expect(hrefs).toContain(
      "/channels/22222222-2222-2222-2222-222222222222/activity?filter=failed",
    );
    expect(hrefs).toContain("/channels/33333333-3333-3333-3333-333333333333");

    // And nothing in the directory list is still a button pretending to navigate.
    expect(document.querySelectorAll("button.row-channel")).toHaveLength(0);
  });
});
