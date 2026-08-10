// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelDetailPage } from "../src/pages/ChannelDetailPage.js";

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

describe("ChannelDetailPage — Activity tab and ingest tokens", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("lists Broadcasts with receivedAt, body preview, and fan-out on the Activity tab", async () => {
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith(`/channels/${CHANNEL_ID}`) && method === "GET") {
        return Promise.resolve(jsonResponse(200, baseChannel()));
      }
      if (url.includes(`/channels/${CHANNEL_ID}/broadcasts`) && method === "GET") {
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
      throw new Error(`unexpected fetch: ${method} ${url}`);
    });

    render(<ChannelDetailPage channelId={CHANNEL_ID} onBack={() => undefined} />);

    fireEvent.click(await screen.findByRole("button", { name: "Activity" }));

    expect(await screen.findByText("hello-world")).toBeTruthy();
    expect(screen.getByText("no Endpoints yet")).toBeTruthy();
  });

  it("shows an empty state when there are no Broadcasts yet", async () => {
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith(`/channels/${CHANNEL_ID}`) && method === "GET") {
        return Promise.resolve(jsonResponse(200, baseChannel()));
      }
      if (url.includes(`/channels/${CHANNEL_ID}/broadcasts`) && method === "GET") {
        return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
      }
      throw new Error(`unexpected fetch: ${method} ${url}`);
    });

    render(<ChannelDetailPage channelId={CHANNEL_ID} onBack={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "Activity" }));

    expect(await screen.findByText(/No Broadcasts yet/)).toBeTruthy();
  });

  it("mints an ingest token, shows the plaintext once, and revoke removes it from the list", async () => {
    const tokenId = "33333333-3333-3333-3333-333333333333";
    let mintedOnServer = false;

    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith(`/channels/${CHANNEL_ID}`) && method === "GET") {
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
      if (url.includes(`/channels/${CHANNEL_ID}/broadcasts`) && method === "GET") {
        return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
      }
      if (url.endsWith(`/channels/${CHANNEL_ID}/tokens`) && method === "POST") {
        mintedOnServer = true;
        return Promise.resolve(
          jsonResponse(201, {
            id: tokenId,
            token: "wbt_abcd1234-plaintext-secret",
            createdAt: "2026-08-10T12:00:00.000Z",
          }),
        );
      }
      if (url.endsWith(`/channels/${CHANNEL_ID}/tokens/${tokenId}`) && method === "DELETE") {
        mintedOnServer = false;
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      throw new Error(`unexpected fetch: ${method} ${url}`);
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
});
