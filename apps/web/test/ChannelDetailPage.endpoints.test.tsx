// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelDetailPage } from "../src/pages/ChannelDetailPage.js";

const CHANNEL_ID = "11111111-1111-1111-1111-111111111111";
const ENDPOINT_ID = "22222222-2222-2222-2222-222222222222";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function channelBody() {
  return {
    id: CHANNEL_ID,
    slug: "orders",
    description: null,
    enabled: true,
    endpointCount: 1,
    tokens: [],
    deletedAt: null,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
  };
}

interface EndpointJson {
  id: string;
  channelId: string;
  name: string | null;
  url: string;
  timeoutMs: number | null;
  headers: Record<string, string>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

function endpointBody(overrides: Partial<EndpointJson> = {}): EndpointJson {
  return {
    id: ENDPOINT_ID,
    channelId: CHANNEL_ID,
    name: "Primary",
    url: "https://example.com/hook",
    timeoutMs: 5000,
    headers: {},
    enabled: true,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

describe("Channel Detail — Endpoints tab", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let endpoints: Array<ReturnType<typeof endpointBody>>;

  beforeEach(() => {
    endpoints = [endpointBody()];
    fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url === `/channels/${CHANNEL_ID}` && method === "GET") {
        return Promise.resolve(jsonResponse(200, channelBody()));
      }
      if (url === `/channels/${CHANNEL_ID}/endpoints` && method === "GET") {
        return Promise.resolve(jsonResponse(200, { items: endpoints, nextCursor: null }));
      }
      if (url === `/channels/${CHANNEL_ID}/endpoints` && method === "POST") {
        const created = endpointBody({
          id: "33333333-3333-3333-3333-333333333333",
          ...JSON.parse(init?.body as string),
        });
        endpoints = [...endpoints, created];
        return Promise.resolve(jsonResponse(201, created));
      }
      if (url === `/channels/${CHANNEL_ID}/endpoints/${ENDPOINT_ID}` && method === "PATCH") {
        const patch = JSON.parse(init?.body as string) as Partial<EndpointJson>;
        const updated: EndpointJson = { ...endpoints[0]!, ...patch };
        endpoints = [updated, ...endpoints.slice(1)];
        return Promise.resolve(jsonResponse(200, updated));
      }
      throw new Error(`unexpected fetch: ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("lists existing Endpoints under the Endpoints tab", async () => {
    render(<ChannelDetailPage channelId={CHANNEL_ID} onBack={() => undefined} />);

    fireEvent.click(await screen.findByRole("button", { name: "Endpoints" }));

    expect(await screen.findByText("Primary")).toBeTruthy();
    expect(screen.getByText("https://example.com/hook")).toBeTruthy();
  });

  it("creates a new Endpoint from the Endpoints tab form", async () => {
    render(<ChannelDetailPage channelId={CHANNEL_ID} onBack={() => undefined} />);

    fireEvent.click(await screen.findByRole("button", { name: "Endpoints" }));
    await screen.findByText("Primary");

    fireEvent.change(screen.getByLabelText("URL", { selector: "#endpoint-url-new" }), {
      target: { value: "https://example.com/new" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Endpoint" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/channels/${CHANNEL_ID}/endpoints`,
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(await screen.findByText("https://example.com/new")).toBeTruthy();
  });

  it("edits an existing Endpoint in place", async () => {
    render(<ChannelDetailPage channelId={CHANNEL_ID} onBack={() => undefined} />);

    fireEvent.click(await screen.findByRole("button", { name: "Endpoints" }));
    fireEvent.click(await screen.findByText("Primary"));

    const nameInput = await screen.findByLabelText("Name", {
      selector: `#endpoint-name-${ENDPOINT_ID}`,
    });
    fireEvent.change(nameInput, { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/channels/${CHANNEL_ID}/endpoints/${ENDPOINT_ID}`,
        expect.objectContaining({ method: "PATCH" }),
      );
    });
    expect(await screen.findByText("Renamed")).toBeTruthy();
  });
});
