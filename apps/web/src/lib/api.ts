import type { LoginResponse } from "@webhook-broadcast/contract";
import { getAdminFetchClient, type paths } from "@webhook-broadcast/contract/client";

/**
 * Request-body shapes lifted straight from the published OpenAPI contract
 * (`paths`) rather than hand-duplicated as parallel `*Input`/`*Patch`
 * interfaces — see issue #28. Callers build these object literals with
 * conditional spreads instead of explicit `key: undefined`, so they satisfy
 * `exactOptionalPropertyTypes` without this wrapper loosening the types.
 */
type ChannelCreateBody = paths["/channels"]["post"]["requestBody"]["content"]["application/json"];
type ChannelUpdateBody =
  paths["/channels/{channelId}"]["patch"]["requestBody"]["content"]["application/json"];
type EndpointCreateBody =
  paths["/channels/{channelId}/endpoints"]["post"]["requestBody"]["content"]["application/json"];
type EndpointUpdateBody =
  paths["/channels/{channelId}/endpoints/{endpointId}"]["patch"]["requestBody"]["content"]["application/json"];

export interface ApiErrorDetail {
  path: string;
  message: string;
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: ApiErrorDetail[] = [],
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

interface ErrorResponseBody {
  error?: {
    code?: string;
    message?: string;
    details?: ApiErrorDetail[];
  };
}

/** Prefer Zod field details over the generic envelope message when present. */
export function formatApiErrorMessage(
  message: string | undefined,
  details: ApiErrorDetail[] | undefined,
  fallback: string,
): string {
  if (details && details.length > 0) {
    return details
      .map((detail) => {
        if (
          detail.path.length === 0 ||
          detail.message.toLowerCase().startsWith(detail.path.toLowerCase())
        ) {
          return detail.message;
        }
        return `${detail.path}: ${detail.message}`;
      })
      .join("; ");
  }
  return message && message.length > 0 ? message : fallback;
}

function throwApiError(
  status: number,
  body: ErrorResponseBody | undefined,
  fallback: string,
): never {
  throw new ApiRequestError(
    status,
    body?.error?.code ?? "unknown",
    formatApiErrorMessage(body?.error?.message, body?.error?.details, fallback),
    body?.error?.details ?? [],
  );
}

async function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): Promise<T> {
  if (result.response.status === 204) {
    return undefined as T;
  }

  if (result.error || !result.response.ok) {
    throwApiError(
      result.response.status,
      result.error as ErrorResponseBody | undefined,
      result.response.statusText,
    );
  }

  return result.data as T;
}

/**
 * Dashboard-only auth routes — intentionally outside the published admin OpenAPI
 * contract (see apps/api/src/admin/authRoutes.ts).
 */
async function authRequest<TResponse>(path: string, init: RequestInit = {}): Promise<TResponse> {
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
    throwApiError(response.status, body as ErrorResponseBody | undefined, response.statusText);
  }

  return body as TResponse;
}

export const api = {
  login: (apiKey: string) =>
    authRequest<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ apiKey }),
    }),
  logout: () => authRequest<void>("/auth/logout", { method: "POST" }),
  session: () => authRequest<{ ok: true }>("/auth/session"),
  listChannels: async () => unwrap(await getAdminFetchClient().GET("/channels")),
  createChannel: async (input: ChannelCreateBody) =>
    unwrap(await getAdminFetchClient().POST("/channels", { body: input })),
  getChannel: async (channelId: string) =>
    unwrap(
      await getAdminFetchClient().GET("/channels/{channelId}", { params: { path: { channelId } } }),
    ),
  /**
   * Resolves a Channel slug to its full record (issue #56), via the exact-match
   * `?slug=` filter issue #40 added to the list route — `channel.slug` is
   * UNIQUE, so this is at most one row. `undefined` means no Channel currently
   * has this slug, which is indistinguishable from — and handled the same as —
   * a slug that once matched but was since renamed away from (see channelRef.ts).
   */
  findChannelBySlug: async (slug: string) => {
    const { items } = await unwrap(
      await getAdminFetchClient().GET("/channels", { params: { query: { slug, limit: 1 } } }),
    );
    return items[0];
  },
  updateChannel: async (channelId: string, patch: ChannelUpdateBody) =>
    unwrap(
      await getAdminFetchClient().PATCH("/channels/{channelId}", {
        params: { path: { channelId } },
        body: patch,
      }),
    ),
  deleteChannel: async (channelId: string) =>
    unwrap(
      await getAdminFetchClient().DELETE("/channels/{channelId}", {
        params: { path: { channelId } },
      }),
    ),
  listEndpoints: async (channelId: string) =>
    unwrap(
      await getAdminFetchClient().GET("/channels/{channelId}/endpoints", {
        params: { path: { channelId } },
      }),
    ),
  createEndpoint: async (channelId: string, input: EndpointCreateBody) =>
    unwrap(
      await getAdminFetchClient().POST("/channels/{channelId}/endpoints", {
        params: { path: { channelId } },
        body: input,
      }),
    ),
  updateEndpoint: async (channelId: string, endpointId: string, patch: EndpointUpdateBody) =>
    unwrap(
      await getAdminFetchClient().PATCH("/channels/{channelId}/endpoints/{endpointId}", {
        params: { path: { channelId, endpointId } },
        body: patch,
      }),
    ),
  deleteEndpoint: async (channelId: string, endpointId: string) =>
    unwrap(
      await getAdminFetchClient().DELETE("/channels/{channelId}/endpoints/{endpointId}", {
        params: { path: { channelId, endpointId } },
      }),
    ),
  listBroadcasts: async (channelId: string, cursor?: string) =>
    unwrap(
      await getAdminFetchClient().GET("/channels/{channelId}/broadcasts", {
        params: {
          path: { channelId },
          query: cursor ? { cursor } : {},
        },
      }),
    ),
  getBroadcastDetail: async (channelId: string, broadcastId: string) =>
    unwrap(
      await getAdminFetchClient().GET("/channels/{channelId}/broadcasts/{broadcastId}", {
        params: { path: { channelId, broadcastId } },
      }),
    ),
  replayBroadcast: async (channelId: string, broadcastId: string) =>
    unwrap(
      await getAdminFetchClient().POST("/channels/{channelId}/broadcasts/{broadcastId}/replay", {
        params: { path: { channelId, broadcastId } },
      }),
    ),
  getDeliveryDetail: async (deliveryId: string) =>
    unwrap(
      await getAdminFetchClient().GET("/deliveries/{deliveryId}", {
        params: { path: { deliveryId } },
      }),
    ),
  listDeliveryAttempts: async (deliveryId: string) =>
    unwrap(
      await getAdminFetchClient().GET("/deliveries/{deliveryId}/attempts", {
        params: { path: { deliveryId } },
      }),
    ),
  retryDelivery: async (deliveryId: string) =>
    unwrap(
      await getAdminFetchClient().POST("/deliveries/{deliveryId}/retry", {
        params: { path: { deliveryId } },
      }),
    ),
  createChannelToken: async (channelId: string) =>
    unwrap(
      await getAdminFetchClient().POST("/channels/{channelId}/tokens", {
        params: { path: { channelId } },
      }),
    ),
  revokeChannelToken: async (channelId: string, tokenId: string) =>
    unwrap(
      await getAdminFetchClient().DELETE("/channels/{channelId}/tokens/{tokenId}", {
        params: { path: { channelId, tokenId } },
      }),
    ),
};
