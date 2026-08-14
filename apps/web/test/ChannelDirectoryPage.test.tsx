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
                  message: "slug is already taken",
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

    // A slug the field itself accepts, so the request actually reaches the API:
    // what is under test is the envelope's `details` winning over its generic
    // `message`, not local validation.
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "unipile-dev" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create Channel" }));
      await Promise.resolve();
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("slug is already taken");
    expect(alert.textContent).not.toContain("invalid channel payload");
  });

  describe("the New Channel form (issue #64)", () => {
    /** The directory's own GET, with no Channels, for the form-shape cases. */
    function stubEmptyDirectory(): void {
      fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
        const path = requestPath(input);
        const method = requestMethod(input, init);
        if (path === "/channels" && method === "GET") {
          return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
        }
        throw new Error(`unexpected fetch: ${method} ${path}`);
      });
    }

    it("puts the Channels list ahead of the create form, on the page and without a modal", async () => {
      stubEmptyDirectory();
      renderRoutes("/");
      await flushAsync();

      const legends = Array.from(document.querySelectorAll(".section-title")).map((node) =>
        (node.textContent ?? "").trim(),
      );
      // Health before detail (PRODUCT.md §1): the list legend precedes the form's.
      expect(legends.indexOf("Channels")).toBeGreaterThan(-1);
      expect(legends.indexOf("Channels")).toBeLessThan(legends.indexOf("New Channel"));

      // Still reachable in place: the form is mounted, not behind a dialog.
      expect(screen.getByRole("button", { name: "Create Channel" })).toBeTruthy();
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it("labels each field with a visible label element, not an aria-label", async () => {
      stubEmptyDirectory();
      renderRoutes("/");
      await flushAsync();

      const fields = [
        { labelText: "Slug", inputId: "new-channel-slug" },
        { labelText: "Description", inputId: "new-channel-description" },
      ];
      for (const { labelText, inputId } of fields) {
        const label = Array.from(document.querySelectorAll("label")).find(
          (node) => (node.textContent ?? "").trim() === labelText,
        );
        // A real, on-screen <label> pointing at the field — `getByLabelText`
        // alone would still pass against the `aria-label` this replaced.
        expect(label).toBeTruthy();
        expect(label?.getAttribute("for")).toBe(inputId);
        const input = screen.getByLabelText(labelText);
        expect(input.id).toBe(inputId);
        expect(input.getAttribute("aria-label")).toBeNull();
      }
    });

    it("keeps the slug format rule on screen before, during, and after typing", async () => {
      stubEmptyDirectory();
      renderRoutes("/");
      await flushAsync();

      const rule = document.getElementById("new-channel-slug-rule");
      expect(rule?.textContent).toContain("Lowercase letters, digits, and hyphens");
      // The field points at the rule, so it is announced with the field too.
      const slugInput = screen.getByLabelText("Slug");
      expect(slugInput.getAttribute("aria-describedby")).toContain("new-channel-slug-rule");

      // A placeholder would have vanished here; the rule does not.
      fireEvent.change(slugInput, { target: { value: "Unipile" } });
      expect(document.getElementById("new-channel-slug-rule")?.textContent).toContain(
        "Lowercase letters, digits, and hyphens",
      );
    });

    it("catches an invalid slug before submit, in the contract's own words", async () => {
      stubEmptyDirectory();
      renderRoutes("/");
      await flushAsync();

      const slugInput = screen.getByLabelText("Slug");

      // Silent on first pass: nothing is announced while the field is being filled.
      fireEvent.change(slugInput, { target: { value: "UnipileDev" } });
      expect(document.getElementById("new-channel-slug-error")).toBeNull();

      // Announced on blur, in the same sentence the admin API would have returned.
      fireEvent.blur(slugInput);
      const error = document.getElementById("new-channel-slug-error");
      expect(error?.textContent).toContain("slug must be lowercase kebab-case (a-z, 0-9, -)");
      expect(slugInput.getAttribute("aria-invalid")).toBe("true");

      // The commit control stays live — invalidity is stated, not expressed by a
      // dead button (DESIGN.md §5) — and pressing it sends no request.
      const submit = screen.getByRole("button", { name: "Create Channel" });
      expect(submit.hasAttribute("disabled")).toBe(false);
      const callsBefore = fetchMock.mock.calls.length;
      await act(async () => {
        fireEvent.click(submit);
        await Promise.resolve();
      });
      expect(fetchMock.mock.calls.length).toBe(callsBefore);

      // Live once marked: the message clears the moment the value becomes valid.
      fireEvent.change(slugInput, { target: { value: "unipile-dev" } });
      expect(document.getElementById("new-channel-slug-error")).toBeNull();
      expect(slugInput.getAttribute("aria-invalid")).toBe("false");
    });

    it("rejects a slug the old hand-rolled check would have let through", async () => {
      stubEmptyDirectory();
      renderRoutes("/");
      await flushAsync();

      // `a--b` matches /^[a-z0-9-]+$/ but not the contract's kebab-case rule, so
      // a local copy of the regex passed input the server then 400'd.
      const slugInput = screen.getByLabelText("Slug");
      fireEvent.change(slugInput, { target: { value: "unipile--dev" } });
      fireEvent.blur(slugInput);

      expect(document.getElementById("new-channel-slug-error")?.textContent).toContain(
        "slug must be lowercase kebab-case (a-z, 0-9, -)",
      );
    });
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
    // Issue #56: the directory links the slug form, not the id — see
    // `channelActivityHref` and `lib/channelRef.ts` for the rule.
    expect(hrefs).toContain("/channels/failing/activity?filter=failed");
    expect(hrefs).toContain("/channels/healthy");

    // And nothing in the directory list is still a button pretending to navigate.
    expect(document.querySelectorAll("button.row-channel")).toHaveLength(0);
  });
});
