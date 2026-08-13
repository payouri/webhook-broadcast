import { useQuery } from "@tanstack/react-query";
import { ApiRequestError, api } from "./api.js";
import { FRESHNESS_POLL_MS, freshnessRefetchInterval, useRefetchOnVisible } from "./freshness.js";

/** The one cache entry every Channel surface reads and every mutation invalidates. */
export function channelQueryKey(channelId: string) {
  return ["channel", channelId] as const;
}

/** True for the admin API's 404 on an unknown or soft-deleted Channel id. */
export function isChannelNotFound(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 404;
}

/**
 * The single Channel query (issue #51): stated once so the surfaces that read
 * one Channel — the detail page header and the Ingest tokens panel — share its
 * key, its ~5s freshness interval (ADR 0004), and its terminal-404 rule instead
 * of each declaring its own copy that can drift.
 *
 * `staleTime` is the poll interval on purpose: a second observer mounting (the
 * tokens panel opening under Settings) reads the Channel already in the cache
 * rather than issuing another `getChannel` for data the page is polling anyway.
 * Invalidation after mint/revoke still refetches immediately, since that marks
 * the entry stale regardless of the window.
 */
export function useChannelQuery(channelId: string) {
  const query = useQuery({
    queryKey: channelQueryKey(channelId),
    queryFn: () => api.getChannel(channelId),
    // ADR 0004 polls this surface ~every 5s, but a 404 is terminal: the Channel
    // was deleted (or never existed) and the view it renders offers no Retry,
    // so keep polling only while the id could still resolve (and only while
    // the tab is visible; see freshnessRefetchInterval).
    refetchInterval: (state) =>
      isChannelNotFound(state.state.error) ? false : freshnessRefetchInterval(),
    staleTime: FRESHNESS_POLL_MS,
  });
  useRefetchOnVisible(() => void query.refetch());
  return query;
}
