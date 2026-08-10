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
});
