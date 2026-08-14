import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiRequestError, api } from "./api.js";
import { isChannelId } from "./channelRef.js";
import { FRESHNESS_POLL_MS, freshnessRefetchInterval, useRefetchOnVisible } from "./freshness.js";

/** The one cache entry every Channel surface reads and every mutation invalidates. */
export function channelQueryKey(channelId: string) {
  return ["channel", channelId] as const;
}

/**
 * The slug→Channel entry a slug-form route resolves through (issue #56). Named
 * rather than inlined at the `useQuery` call below because a slug rename seeds
 * this entry for the new slug, and that happens on the detail page — the key
 * has two writers, so it cannot be spelled out at only one of them.
 */
export function channelSlugLookupKey(slug: string) {
  return ["channel-slug-lookup", slug] as const;
}

/**
 * True when a `getChannel` failure means the Channel id in the route can never
 * resolve, whichever of the admin API's two ways of saying so it used:
 *
 * - **404** — no such id, or one that was soft-deleted.
 * - **400 `validation_failed`** — the segment passed `isChannelId` (a loose
 *   8-4-4-4-12 hex shape check, issue #56) but not the API's stricter
 *   `z.uuid()` (version and variant nibbles, `requireUuidParam`): a hand-typed
 *   or corrupted id that merely *looks* like a UUID.
 *
 * Both are one fact to the operator — this address has no view — and it is
 * issue #57's job that neither degrades into the API's internal validation
 * string reaching the screen.
 *
 * Named for the route, not for "not found", because the 400 branch is only
 * sound on an error from `GET /channels/:channelId`, whose sole validated
 * input *is* that path param. The same code on a mutation (`PATCH` rejecting a
 * slug edit) reports a bad *body*, and reading that as an unresolvable route
 * would replace a form the operator can fix with a dead end. Pass this only
 * `useChannelQuery`'s error.
 */
export function isUnresolvableChannelRoute(error: unknown): boolean {
  if (!(error instanceof ApiRequestError)) {
    return false;
  }
  return error.status === 404 || (error.status === 400 && error.code === "validation_failed");
}

/**
 * The single Channel query (issue #51): stated once so the surfaces that read
 * one Channel — the detail page header and the Ingest tokens panel — share its
 * key, its ~5s freshness interval (ADR 0004), and its terminal-not-found rule
 * (`isUnresolvableChannelRoute`) instead of each declaring its own copy that
 * can drift.
 *
 * `staleTime` is the poll interval on purpose: a second observer mounting (the
 * tokens panel opening under Settings) reads the Channel already in the cache
 * rather than issuing another `getChannel` for data the page is polling anyway.
 * Invalidation after mint/revoke still refetches immediately, since that marks
 * the entry stale regardless of the window.
 */
export function useChannelQuery(channelId: string, options: { enabled?: boolean } = {}) {
  const enabled = options.enabled ?? true;
  const query = useQuery({
    queryKey: channelQueryKey(channelId),
    queryFn: () => api.getChannel(channelId),
    enabled,
    // ADR 0004 polls this surface ~every 5s, but a not-found (issue #57: 404,
    // or 400 for an id shaped enough to pass `isChannelId` but not the API's
    // stricter check) is terminal: the view it renders offers no Retry, so
    // keep polling only while the id could still resolve (and only while the
    // tab is visible; see freshnessRefetchInterval).
    refetchInterval: (state) =>
      enabled && !isUnresolvableChannelRoute(state.state.error)
        ? freshnessRefetchInterval()
        : false,
    staleTime: FRESHNESS_POLL_MS,
  });
  useRefetchOnVisible(() => {
    if (enabled) {
      void query.refetch();
    }
  });
  return query;
}

/**
 * Resolves a Channel route segment (issue #56) — a UUID id or a slug, see
 * `channelRef.ts` for which form is canonical where — to the id every nested
 * query and mutation on the detail page actually keys on. Id segments resolve
 * for free (they already are the id); a slug segment costs one `?slug=`
 * lookup, whose result is seeded straight into `useChannelQuery`'s own cache
 * entry so the detail page's normal Channel fetch reads it from cache instead
 * of issuing a second request for data this call already has in hand.
 *
 * Three outcomes, and the caller owes a view for each: an id (render), no such
 * slug (`isSlugNotFound` — the ordinary Channel-not-found view), or a lookup
 * that failed for some other reason (`error` — an inline error plus `retry`,
 * since retries are off app-wide, see `queryClient.ts`). Without that third
 * branch a single failed request would leave the page loading forever.
 */
export function useChannelRouteId(routeSegment: string): {
  channelId: string | undefined;
  isSlugNotFound: boolean;
  error: Error | null;
  retry: () => void;
} {
  const queryClient = useQueryClient();
  const isId = isChannelId(routeSegment);

  const slugLookup = useQuery({
    queryKey: channelSlugLookupKey(routeSegment),
    queryFn: async () => {
      const found = await api.findChannelBySlug(routeSegment);
      if (found) {
        queryClient.setQueryData(channelQueryKey(found.id), found);
      }
      return found ?? null;
    },
    enabled: !isId && routeSegment.length > 0,
    staleTime: FRESHNESS_POLL_MS,
  });

  return {
    channelId: isId ? routeSegment : slugLookup.data?.id,
    // `null` is the lookup's own "ran, matched nothing"; a disabled lookup (an
    // id segment) leaves `data` undefined, so an id can never read as missing.
    isSlugNotFound: slugLookup.data === null,
    error: slugLookup.error,
    retry: () => void slugLookup.refetch(),
  };
}
