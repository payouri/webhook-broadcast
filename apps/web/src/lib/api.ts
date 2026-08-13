import type { LoginResponse } from "@webhook-broadcast/contract";
import { getAdminFetchClient } from "@webhook-broadcast/contract/client";

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

export interface ChannelInput {
  slug: string;
  description?: string | undefined;
  enabled?: boolean | undefined;
  allowUnauthenticatedIngest?: boolean | undefined;
}

export interface ChannelPatch {
  slug?: string;
  description?: string | null;
  enabled?: boolean;
  allowUnauthenticatedIngest?: boolean;
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
    authRequest<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ apiKey }),
    }),
  logout: () => authRequest<void>("/auth/logout", { method: "POST" }),
  session: () => authRequest<{ ok: true }>("/auth/session"),
  listChannels: async () => unwrap(await getAdminFetchClient().GET("/channels")),
  createChannel: async (input: ChannelInput) =>
    unwrap(
      await getAdminFetchClient().POST("/channels", {
        body: {
          slug: input.slug,
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...(input.allowUnauthenticatedIngest !== undefined
            ? { allowUnauthenticatedIngest: input.allowUnauthenticatedIngest }
            : {}),
        },
      }),
    ),
  getChannel: async (channelId: string) =>
    unwrap(
      await getAdminFetchClient().GET("/channels/{channelId}", { params: { path: { channelId } } }),
    ),
  updateChannel: async (channelId: string, patch: ChannelPatch) =>
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
  createEndpoint: async (channelId: string, input: EndpointInput) =>
    unwrap(
      await getAdminFetchClient().POST("/channels/{channelId}/endpoints", {
        params: { path: { channelId } },
        body: {
          url: input.url,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
          ...(input.headers !== undefined ? { headers: input.headers } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        },
      }),
    ),
  updateEndpoint: async (channelId: string, endpointId: string, patch: EndpointPatch) =>
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
