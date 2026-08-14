// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ingestUrl } from "../src/lib/ingestUrl.js";
import { renderRoutes, requestMethod, requestPath, stubFetchMock } from "./fetchMock.js";

const CHANNEL_ID = "11111111-1111-1111-1111-111111111111";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function baseChannel(
  overrides: Partial<{
    slug: string;
    allowUnauthenticatedIngest: boolean;
    tokens: { id: string; prefix: string; createdAt: string }[];
  }> = {},
) {
  return {
    id: CHANNEL_ID,
    slug: overrides.slug ?? "orders",
    description: "Order events",
    enabled: true,
    endpointCount: 0,
    allowUnauthenticatedIngest: overrides.allowUnauthenticatedIngest ?? false,
    tokens: overrides.tokens ?? [],
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

describe("Ingest URL visibility (issue #47)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    stubFetchMock(fetchMock);
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the full ingest URL permanently, on a tab with no Activity at all", async () => {
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);

      if (path === `/channels/${CHANNEL_ID}` && method === "GET") {
        return Promise.resolve(jsonResponse(200, baseChannel({ slug: "orders" })));
      }
      if (path === `/channels/${CHANNEL_ID}/endpoints` && method === "GET") {
        return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    renderRoutes(`/channels/${CHANNEL_ID}`);

    // The Endpoints tab has nothing to do with Broadcast activity, yet the
    // ingest URL is present here too — it lives on the Channel, not the
    // Activity empty state.
    fireEvent.click(await screen.findByRole("link", { name: "Endpoints" }));

    expect(await screen.findByText(ingestUrl("orders"))).toBeTruthy();
  });

  it("copies the ingest URL and confirms the copy", async () => {
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);

      if (path === `/channels/${CHANNEL_ID}` && method === "GET") {
        return Promise.resolve(jsonResponse(200, baseChannel({ slug: "orders" })));
      }
      if (path === `/channels/${CHANNEL_ID}/broadcasts` && method === "GET") {
        return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    renderRoutes(`/channels/${CHANNEL_ID}`);

    await screen.findByText(ingestUrl("orders"));
    const [copyButton] = await screen.findAllByRole("button", { name: "Copy" });
    fireEvent.click(copyButton!);

    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(ingestUrl("orders"));
  });

  it("says so when the copy fails instead of appearing to do nothing", async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("not allowed")) },
    });
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);

      if (path === `/channels/${CHANNEL_ID}` && method === "GET") {
        return Promise.resolve(jsonResponse(200, baseChannel({ slug: "orders" })));
      }
      if (path === `/channels/${CHANNEL_ID}/broadcasts` && method === "GET") {
        return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    renderRoutes(`/channels/${CHANNEL_ID}`);

    await screen.findByText(ingestUrl("orders"));
    const [copyButton] = await screen.findAllByRole("button", { name: "Copy" });
    fireEvent.click(copyButton!);

    expect(await screen.findByRole("button", { name: "Copy failed" })).toBeTruthy();
  });

  it("calls out unauthenticated ingest right where the URL is shown", async () => {
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);

      if (path === `/channels/${CHANNEL_ID}` && method === "GET") {
        return Promise.resolve(
          jsonResponse(
            200,
            baseChannel({
              slug: "a-long-enough-unguessable-slug-value",
              allowUnauthenticatedIngest: true,
            }),
          ),
        );
      }
      if (path === `/channels/${CHANNEL_ID}/broadcasts` && method === "GET") {
        return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    renderRoutes(`/channels/${CHANNEL_ID}`);

    expect(await screen.findByText(/Unauthenticated ingest is enabled/)).toBeTruthy();
  });

  it("does not warn about unauthenticated ingest for a Channel that requires a token", async () => {
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);

      if (path === `/channels/${CHANNEL_ID}` && method === "GET") {
        return Promise.resolve(jsonResponse(200, baseChannel({ slug: "orders" })));
      }
      if (path === `/channels/${CHANNEL_ID}/broadcasts` && method === "GET") {
        return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    renderRoutes(`/channels/${CHANNEL_ID}`);

    await screen.findByText(ingestUrl("orders"));
    expect(screen.queryByText(/Unauthenticated ingest is enabled/)).toBeNull();
  });

  describe("slug rename warning in Settings", () => {
    beforeEach(() => {
      fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
        const path = requestPath(input);
        const method = requestMethod(input, init);

        if (path === `/channels/${CHANNEL_ID}` && method === "GET") {
          return Promise.resolve(jsonResponse(200, baseChannel({ slug: "orders" })));
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

    it("shows no warning while the slug is untouched", async () => {
      renderRoutes(`/channels/${CHANNEL_ID}`);
      fireEvent.click(await screen.findByRole("link", { name: "Settings" }));

      await screen.findByDisplayValue("orders");
      expect(screen.queryByText(/Renaming the slug changes the ingest URL/)).toBeNull();
    });

    it("shows the future URL and a breakage warning once the slug is edited", async () => {
      renderRoutes(`/channels/${CHANNEL_ID}`);
      fireEvent.click(await screen.findByRole("link", { name: "Settings" }));

      const slugInput = await screen.findByLabelText("Slug");
      fireEvent.change(slugInput, { target: { value: "orders-v2" } });

      const warning = await screen.findByText(/Renaming the slug changes the ingest URL/);
      expect(warning.textContent).toContain(ingestUrl("orders-v2"));
      expect(warning.textContent).toContain(ingestUrl("orders"));
      expect(warning.textContent).toContain("stop being accepted");
    });

    it("clears the warning once the slug is edited back to its saved value", async () => {
      renderRoutes(`/channels/${CHANNEL_ID}`);
      fireEvent.click(await screen.findByRole("link", { name: "Settings" }));

      const slugInput = await screen.findByLabelText("Slug");
      fireEvent.change(slugInput, { target: { value: "orders-v2" } });
      await screen.findByText(/Renaming the slug changes the ingest URL/);

      fireEvent.change(slugInput, { target: { value: "orders" } });
      await flushAsync();

      expect(screen.queryByText(/Renaming the slug changes the ingest URL/)).toBeNull();
    });
  });

  describe("minting an ingest token", () => {
    it("warns before minting that the token is shown once and cannot be retrieved later", async () => {
      fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
        const path = requestPath(input);
        const method = requestMethod(input, init);

        if (path === `/channels/${CHANNEL_ID}` && method === "GET") {
          return Promise.resolve(jsonResponse(200, baseChannel({ slug: "orders" })));
        }
        if (path === `/channels/${CHANNEL_ID}/broadcasts` && method === "GET") {
          return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
        }
        throw new Error(`unexpected fetch: ${method} ${path}`);
      });

      renderRoutes(`/channels/${CHANNEL_ID}`);
      fireEvent.click(await screen.findByRole("link", { name: "Settings" }));

      // Visible before any mint happens — not only after the fact.
      expect(
        await screen.findByText(/shown once, right here.*cannot be retrieved later/),
      ).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Copy" })).toBeTruthy(); // ingest URL copy, mint not clicked yet
    });

    it("mints a token with a copy action next to the plaintext", async () => {
      const tokenId = "33333333-3333-3333-3333-333333333333";
      fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
        const path = requestPath(input);
        const method = requestMethod(input, init);

        if (path === `/channels/${CHANNEL_ID}` && method === "GET") {
          return Promise.resolve(jsonResponse(200, baseChannel({ slug: "orders" })));
        }
        if (path === `/channels/${CHANNEL_ID}/broadcasts` && method === "GET") {
          return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
        }
        if (path === `/channels/${CHANNEL_ID}/tokens` && method === "POST") {
          return Promise.resolve(
            jsonResponse(201, {
              id: tokenId,
              token: "wbt_secret-plaintext",
              createdAt: "2026-08-10T12:00:00.000Z",
            }),
          );
        }
        throw new Error(`unexpected fetch: ${method} ${path}`);
      });

      renderRoutes(`/channels/${CHANNEL_ID}`);
      fireEvent.click(await screen.findByRole("link", { name: "Settings" }));
      fireEvent.click(await screen.findByRole("button", { name: "Mint new token" }));

      expect(await screen.findByText("wbt_secret-plaintext")).toBeTruthy();

      const copyButtons = screen.getAllByRole("button", { name: "Copy" });
      const lastCopyButton = copyButtons.at(-1);
      expect(lastCopyButton).toBeTruthy();
      fireEvent.click(lastCopyButton!);

      expect(await screen.findAllByRole("button", { name: "Copied" })).not.toHaveLength(0);
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("wbt_secret-plaintext");
    });
  });
});
