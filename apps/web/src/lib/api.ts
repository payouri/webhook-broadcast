import type { ErrorCode, LoginResponse } from "@webhook-broadcast/contract";
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
    /** Epoch ms a `rate_limited` response reports its cooldown ends (issue #91). */
    readonly resetAt?: number,
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
  resetAt?: number;
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
    body?.resetAt,
  );
}

/**
 * The contract codes whose `message` a handler deliberately wrote for a human
 * to read ("channel not found", "slug already exists", "invalid operator API
 * key"). Deliberately an allowlist, not a denylist of the unauthored ones:
 * `code` arrives as an untrusted string, so anything off-contract — a gateway
 * that answers with its own JSON envelope, `throwApiError`'s `"unknown"` when
 * the body didn't parse as an envelope at all — lands on the safe side and gets
 * described rather than echoed. `internal_error` is excluded on purpose: it is
 * `app.ts`'s catch-all for a crash no handler anticipated, so its "internal
 * server error" is transport detail dressed as content.
 */
const AUTHORED_ERROR_CODES: ReadonlySet<string> = new Set<Exclude<ErrorCode, "internal_error">>([
  "unauthorized",
  "not_found",
  "conflict",
  "validation_failed",
  "payload_too_large",
  "rate_limited",
]);

/**
 * Renders a caught error for direct display on a control (issue #58). Zod field
 * detail (`ApiRequestError.details`) is already named in the domain's own terms
 * and renders verbatim, as does an authored code's message. Everything else —
 * a crash, an off-contract envelope, a status nobody wrote a message for — is
 * unhandled by definition, so the caller's own domain sentence renders instead
 * of a `statusText`. The status code still rides along, because PRODUCT.md's
 * voice asks an error to name it and it is the one part of an unhandled failure
 * the operator can act on; a transport failure that never reached the server
 * has no status to name.
 */
export function describeApiError(err: unknown, fallback: string): string {
  if (!(err instanceof ApiRequestError)) {
    return fallback;
  }
  if (err.details.length > 0 || AUTHORED_ERROR_CODES.has(err.code)) {
    return err.message;
  }
  return `${fallback} (HTTP ${err.status})`;
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
  /**
   * `endpointId` + `status: "failed"` (issue #84/#98) narrow this Channel's
   * Activity to one Endpoint's failing Broadcasts, on the same keyset cursor
   * the unfiltered call uses — the two arrive together or not at all, per the
   * contract's `superRefine`.
   */
  listBroadcasts: async (
    channelId: string,
    options: { cursor?: string; endpointId?: string; status?: "failed" } = {},
  ) =>
    unwrap(
      await getAdminFetchClient().GET("/channels/{channelId}/broadcasts", {
        params: {
          path: { channelId },
          query: {
            ...(options.cursor ? { cursor: options.cursor } : {}),
            ...(options.endpointId
              ? { endpointId: options.endpointId, status: options.status ?? "failed" }
              : {}),
          },
        },
      }),
    ),
  /** `GET /channels/{id}/failures` (issue #84/#98): the ranked roll-up behind the reactive Activity view. */
  listChannelFailures: async (channelId: string) =>
    unwrap(
      await getAdminFetchClient().GET("/channels/{channelId}/failures", {
        params: { path: { channelId } },
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
