// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelDirectoryPage } from "../src/pages/ChannelDirectoryPage.js";
import { FRESHNESS_POLL_MS } from "../src/lib/freshness.js";
import { renderWithQueryClient, requestMethod, requestPath, stubFetchMock } from "./fetchMock.js";

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

    renderWithQueryClient(<ChannelDirectoryPage onOpenChannel={() => undefined} />);

    await flushAsync();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FRESHNESS_POLL_MS);
    });

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

    renderWithQueryClient(<ChannelDirectoryPage onOpenChannel={() => undefined} />);
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

    renderWithQueryClient(<ChannelDirectoryPage onOpenChannel={() => undefined} />);

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
});
