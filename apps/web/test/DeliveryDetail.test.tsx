// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryDetail } from "../src/pages/DeliveryDetail.js";

const DELIVERY_ID = "44444444-4444-4444-4444-444444444444";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function baseDelivery(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: DELIVERY_ID,
    endpointId: "55555555-5555-5555-5555-555555555555",
    endpointName: "Orders webhook",
    endpointUrl: "https://example.com/hook",
    status: "dead_lettered" as const,
    attemptCount: 2,
    lastStatusCode: 503,
    lastDurationMs: 42,
    lastError: "service unavailable",
    updatedAt: "2026-08-10T12:00:00.000Z",
    ...overrides,
  };
}

describe("DeliveryDetail — Attempt timeline and Retry action (issue #21)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows Endpoint identity and status, and loads the Attempt timeline on expand", async () => {
    fetchMock.mockImplementation((input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith(`/deliveries/${DELIVERY_ID}/attempts`)) {
        return Promise.resolve(
          jsonResponse(200, {
            items: [
              {
                id: "a1",
                n: 1,
                statusCode: 503,
                durationMs: 10,
                error: null,
                at: "2026-08-10T12:00:00.000Z",
              },
              {
                id: "a2",
                n: 2,
                statusCode: null,
                durationMs: 20,
                error: "timed out after 10000ms",
                at: "2026-08-10T12:01:00.000Z",
              },
            ],
            nextCursor: null,
          }),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<DeliveryDetail delivery={baseDelivery()} onRetried={() => undefined} />);

    expect(screen.getByText("dead lettered")).toBeTruthy();
    expect(screen.getByText("Orders webhook")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Orders webhook/ }));

    expect(await screen.findByText("#1")).toBeTruthy();
    expect(await screen.findByText("#2")).toBeTruthy();
    expect(screen.getByText("timed out after 10000ms")).toBeTruthy();
  });

  it("shows a Retry action only when dead_lettered, and calls onRetried after a successful retry", async () => {
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      if (url.endsWith(`/deliveries/${DELIVERY_ID}/attempts`)) {
        return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
      }
      if (url.endsWith(`/deliveries/${DELIVERY_ID}/retry`) && method === "POST") {
        return Promise.resolve(jsonResponse(200, baseDelivery({ status: "pending" })));
      }
      throw new Error(`unexpected fetch: ${method} ${url}`);
    });

    const onRetried = vi.fn();
    render(<DeliveryDetail delivery={baseDelivery()} onRetried={onRetried} />);
    fireEvent.click(screen.getByRole("button", { name: /Orders webhook/ }));

    const retryButton = await screen.findByRole("button", { name: "Retry" });
    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(onRetried).toHaveBeenCalledTimes(1);
    });
  });

  it("hides the Retry action for a succeeded Delivery", async () => {
    fetchMock.mockImplementation((input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith(`/deliveries/${DELIVERY_ID}/attempts`)) {
        return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(
      <DeliveryDetail
        delivery={baseDelivery({ status: "succeeded", lastStatusCode: 200, lastError: null })}
        onRetried={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Orders webhook/ }));

    await screen.findByText("No Attempts yet.");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });
});
