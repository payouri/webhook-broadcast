import type {
  AttemptList,
  BroadcastDetail,
  BroadcastList,
  Channel,
  ChannelList,
  ChannelTokenCreated,
  DeliveryDetail,
  Endpoint,
  EndpointList,
  LoginResponse,
} from "@webhook-broadcast/contract";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

interface ErrorResponseBody {
  error?: { code?: string; message?: string };
}

/**
 * Same-origin fetch (see apps/web/vite.config.ts dev proxy and
 * apps/web/nginx.conf) — the HttpOnly session cookie only survives the trip
 * when the browser treats the admin API as same-site.
 */
async function request<TResponse>(path: string, init: RequestInit = {}): Promise<TResponse> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...init.headers },
  });

  if (response.status === 204) {
    return undefined as TResponse;
  }

  const body: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    const errorBody = body as ErrorResponseBody | undefined;
    throw new ApiRequestError(
      response.status,
      errorBody?.error?.code ?? "unknown",
      errorBody?.error?.message ?? response.statusText,
    );
  }

  return body as TResponse;
}

export interface ChannelInput {
  slug: string;
  description?: string | undefined;
  enabled?: boolean | undefined;
}

export interface ChannelPatch {
  slug?: string;
  description?: string | null;
  enabled?: boolean;
}

export interface EndpointInput {
  name?: string | undefined;
  url: string;
  timeoutMs?: number | undefined;
  headers?: Record<string, string> | undefined;
  enabled?: boolean | undefined;
}

export interface EndpointPatch {
  name?: string | null;
  url?: string;
  timeoutMs?: number | null;
  headers?: Record<string, string>;
  enabled?: boolean;
}

export const api = {
  login: (apiKey: string) =>
    request<LoginResponse>("/auth/login", { method: "POST", body: JSON.stringify({ apiKey }) }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  session: () => request<{ ok: true }>("/auth/session"),
  listChannels: () => request<ChannelList>("/channels"),
  createChannel: (input: ChannelInput) =>
    request<Channel>("/channels", { method: "POST", body: JSON.stringify(input) }),
  getChannel: (channelId: string) => request<Channel>(`/channels/${channelId}`),
  updateChannel: (channelId: string, patch: ChannelPatch) =>
    request<Channel>(`/channels/${channelId}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteChannel: (channelId: string) =>
    request<void>(`/channels/${channelId}`, { method: "DELETE" }),
  listEndpoints: (channelId: string) => request<EndpointList>(`/channels/${channelId}/endpoints`),
  createEndpoint: (channelId: string, input: EndpointInput) =>
    request<Endpoint>(`/channels/${channelId}/endpoints`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateEndpoint: (channelId: string, endpointId: string, patch: EndpointPatch) =>
    request<Endpoint>(`/channels/${channelId}/endpoints/${endpointId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  listBroadcasts: (channelId: string, cursor?: string) =>
    request<BroadcastList>(
      `/channels/${channelId}/broadcasts${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    ),
  getBroadcastDetail: (channelId: string, broadcastId: string) =>
    request<BroadcastDetail>(`/channels/${channelId}/broadcasts/${broadcastId}`),
  replayBroadcast: (channelId: string, broadcastId: string) =>
    request<{ id: string }>(`/channels/${channelId}/broadcasts/${broadcastId}/replay`, {
      method: "POST",
    }),
  getDeliveryDetail: (deliveryId: string) => request<DeliveryDetail>(`/deliveries/${deliveryId}`),
  listDeliveryAttempts: (deliveryId: string) =>
    request<AttemptList>(`/deliveries/${deliveryId}/attempts`),
  retryDelivery: (deliveryId: string) =>
    request<DeliveryDetail>(`/deliveries/${deliveryId}/retry`, { method: "POST" }),
  createChannelToken: (channelId: string) =>
    request<ChannelTokenCreated>(`/channels/${channelId}/tokens`, { method: "POST" }),
  revokeChannelToken: (channelId: string, tokenId: string) =>
    request<void>(`/channels/${channelId}/tokens/${tokenId}`, { method: "DELETE" }),
};
