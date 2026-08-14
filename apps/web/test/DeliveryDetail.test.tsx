// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryDetail } from "../src/pages/DeliveryDetail.js";
import { requestMethod, requestPath, stubFetchMock } from "./fetchMock.js";

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
    stubFetchMock(fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows Endpoint identity and status, and loads the Attempt timeline on expand", async () => {
    fetchMock.mockImplementation((input: string | URL | Request) => {
      const path = requestPath(input);
      if (path === `/deliveries/${DELIVERY_ID}/attempts`) {
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
      throw new Error(`unexpected fetch: ${path}`);
    });

    render(<DeliveryDetail delivery={baseDelivery()} onRetried={() => undefined} />);

    expect(screen.getByText("dead lettered")).toBeTruthy();
    expect(screen.getByText("Orders webhook")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Orders webhook/ }));

    expect(await screen.findByText("Attempt 1 of 8")).toBeTruthy();
    expect(await screen.findByText("Attempt 2 of 8")).toBeTruthy();
    expect(screen.getByText("timed out after 10000ms")).toBeTruthy();
    // The gap since the previous Attempt is legible on the second row.
    expect(screen.getByText("waited 1m")).toBeTruthy();
  });

  it("states a shared error once, not once per Attempt row", async () => {
    fetchMock.mockImplementation((input: string | URL | Request) => {
      const path = requestPath(input);
      if (path === `/deliveries/${DELIVERY_ID}/attempts`) {
        return Promise.resolve(
          jsonResponse(200, {
            items: [
              {
                id: "a1",
                n: 1,
                statusCode: null,
                durationMs: 20,
                error: "request timed out after 15000ms",
                at: "2026-08-10T11:00:00.000Z",
              },
              {
                id: "a2",
                n: 2,
                statusCode: null,
                durationMs: 20,
                error: "request timed out after 15000ms",
                at: "2026-08-10T11:00:05.000Z",
              },
              {
                id: "a3",
                n: 3,
                statusCode: null,
                durationMs: 20,
                error: "request timed out after 15000ms",
                at: "2026-08-10T11:00:15.000Z",
              },
            ],
            nextCursor: null,
          }),
        );
      }
      throw new Error(`unexpected fetch: ${path}`);
    });

    render(
      <DeliveryDetail
        delivery={baseDelivery({ lastError: "request timed out after 15000ms" })}
        onRetried={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Orders webhook/ }));

    await screen.findByText("Attempt 3 of 8");
    // Once as the Delivery summary, and never again per Attempt row.
    expect(screen.getAllByText("request timed out after 15000ms")).toHaveLength(1);
  });

  it("shows a Retry action only when dead_lettered, and calls onRetried after a successful retry", async () => {
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);
      if (path === `/deliveries/${DELIVERY_ID}/attempts`) {
        return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
      }
      if (path === `/deliveries/${DELIVERY_ID}/retry` && method === "POST") {
        return Promise.resolve(jsonResponse(200, baseDelivery({ status: "pending" })));
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
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

  it("reports a retry as an Activity change, and only when the retry succeeded (issue #72)", async () => {
    // `onRetried` refreshes the Broadcast detail this row sits in;
    // `onActivityChanged` refreshes the Activity list the parent row's lamp
    // reads. A retry moves the Delivery out of `dead_lettered`, so it changes
    // both — but a failed retry changed nothing and must announce nothing.
    let retryStatus = 500;
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);
      if (path === `/deliveries/${DELIVERY_ID}/attempts`) {
        return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
      }
      if (path === `/deliveries/${DELIVERY_ID}/retry` && method === "POST") {
        return Promise.resolve(
          retryStatus === 200
            ? jsonResponse(200, baseDelivery({ status: "pending" }))
            : jsonResponse(500, { error: { message: "worker unreachable" } }),
        );
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    const onActivityChanged = vi.fn();
    render(
      <DeliveryDetail
        delivery={baseDelivery()}
        onRetried={() => undefined}
        onActivityChanged={onActivityChanged}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Orders webhook/ }));

    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await screen.findByRole("alert");
    expect(onActivityChanged).not.toHaveBeenCalled();

    retryStatus = 200;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(onActivityChanged).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps the failure reason on screen when a failed retry replaces the summary line", async () => {
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);
      if (path === `/deliveries/${DELIVERY_ID}/attempts`) {
        return Promise.resolve(
          jsonResponse(200, {
            items: [
              {
                id: "a1",
                n: 1,
                statusCode: 503,
                durationMs: 20,
                error: "service unavailable",
                at: "2026-08-10T12:00:00.000Z",
              },
            ],
            nextCursor: null,
          }),
        );
      }
      if (path === `/deliveries/${DELIVERY_ID}/retry` && method === "POST") {
        return Promise.resolve(jsonResponse(500, { error: { code: "internal", message: "boom" } }));
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    // The Attempt's error matches `lastError`, so the summary line is what
    // normally states it and the Attempt row suppresses the repeat.
    render(<DeliveryDetail delivery={baseDelivery()} onRetried={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /Orders webhook/ }));

    await screen.findByText("Attempt 1 of 8");
    expect(screen.getAllByText("service unavailable")).toHaveLength(1);

    // A failed retry takes the summary line's slot. The Attempt row must then
    // state the error itself rather than suppress it against a line that is
    // no longer rendered.
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

    await screen.findByRole("alert");
    expect(screen.getAllByText("service unavailable")).toHaveLength(1);
  });

  it("announces a missing status code by meaning, not as a bare dash", async () => {
    fetchMock.mockImplementation((input: string | URL | Request) => {
      const path = requestPath(input);
      if (path === `/deliveries/${DELIVERY_ID}/attempts`) {
        return Promise.resolve(
          jsonResponse(200, {
            items: [
              {
                id: "a1",
                n: 1,
                statusCode: null,
                durationMs: 20,
                error: "timed out after 10000ms",
                at: "2026-08-10T12:00:00.000Z",
              },
            ],
            nextCursor: null,
          }),
        );
      }
      throw new Error(`unexpected fetch: ${path}`);
    });

    render(
      <DeliveryDetail
        delivery={baseDelivery({ lastStatusCode: null })}
        onRetried={() => undefined}
      />,
    );

    // The Delivery row: an accessible name, and the dash still on screen.
    const deliveryPlaceholder = screen.getByRole("img", { name: "No status code recorded" });
    expect(deliveryPlaceholder.textContent).toBe("—");

    fireEvent.click(screen.getByRole("button", { name: /Orders webhook/ }));
    await screen.findByText("Attempt 1 of 8");

    // Plus the Attempt row's own placeholder.
    expect(screen.getAllByRole("img", { name: "No status code recorded" })).toHaveLength(2);
  });

  it("hides the Retry action for a succeeded Delivery", async () => {
    fetchMock.mockImplementation((input: string | URL | Request) => {
      const path = requestPath(input);
      if (path === `/deliveries/${DELIVERY_ID}/attempts`) {
        return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
      }
      throw new Error(`unexpected fetch: ${path}`);
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
