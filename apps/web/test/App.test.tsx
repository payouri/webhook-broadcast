// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
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

describe("dashboard smoke flow", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
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
    expect(screen.getByText("2 endpoints")).toBeTruthy();

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
});
