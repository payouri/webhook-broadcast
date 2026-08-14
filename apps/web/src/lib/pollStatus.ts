/**
 * Issue #54: ADR 0004 polls the Channel list, Activity, Endpoints, and
 * Broadcast deliveries every ~5s, but nothing on screen said so — a poll that
 * had been failing for ten minutes looked exactly like a Channel that had
 * been quiet for ten minutes. This is the one place that tells the two apart,
 * from the two facts a TanStack Query result already carries:
 *
 * - `dataUpdatedAt`: the timestamp of the last fetch that actually succeeded.
 *   React Query does not clear `data` (or this) when a later background
 *   refetch fails, so it stays the honest answer to "when did we last hear
 *   from the server" even while a poll is failing.
 * - `isError`: true for the *current* fetch attempt, independent of whether
 *   an earlier one ever succeeded.
 *
 * `"unknown"` is the state before the very first fetch has resolved either
 * way — nothing to say "last refreshed" about yet, and the existing
 * loading/error views (`SkeletonRows`, `InlineLoadError`) already own that
 * moment, so a poll-status line renders nothing rather than a duplicate.
 */
export type PollStatus =
  | { state: "unknown" }
  | { state: "ok"; lastUpdatedAt: number }
  | { state: "failing"; lastUpdatedAt: number };

export function derivePollStatus(query: { dataUpdatedAt: number; isError: boolean }): PollStatus {
  if (query.dataUpdatedAt === 0) {
    return { state: "unknown" };
  }
  return query.isError
    ? { state: "failing", lastUpdatedAt: query.dataUpdatedAt }
    : { state: "ok", lastUpdatedAt: query.dataUpdatedAt };
}
