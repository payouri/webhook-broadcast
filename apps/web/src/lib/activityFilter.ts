import type { FanoutSummary } from "@webhook-broadcast/contract";

/**
 * Client-side Activity filter (issue #51): the fan-out aggregate already on
 * `BroadcastListItem` is enough to tell whether a Broadcast's fan-out produced
 * a failed or dead-lettered Delivery, so filtering by that fact needs no new
 * endpoint. PRODUCT.md ranks tracing a failure as the second most frequent job
 * and requires "one navigation path (not a search)" to the underlying error; a
 * server-side filter would scale better but is a contract change left for
 * later — this is the client-side version the fan-out summary already allows.
 */
export type ActivityFilter = "all" | "failed";

export const ACTIVITY_FILTER_PARAM = "filter";
const FAILED_FILTER_VALUE = "failed";

/** Reads the Activity filter from the URL; anything else falls back to "all". */
export function activityFilterFromParams(searchParams: URLSearchParams): ActivityFilter {
  return searchParams.get(ACTIVITY_FILTER_PARAM) === FAILED_FILTER_VALUE ? "failed" : "all";
}

/** The `?filter=failed` query string for a filter, or "" for "all" (the unfiltered default). */
export function activityFilterSearch(filter: ActivityFilter): string {
  return filter === "failed" ? `?${ACTIVITY_FILTER_PARAM}=${FAILED_FILTER_VALUE}` : "";
}

/**
 * True when a Broadcast's fan-out produced at least one failed or
 * dead-lettered Delivery. Both are terminal states (ADR 0003): a non-retryable
 * outcome finishes as `failed` without a retry, a retryable one that spends its
 * budget finishes as `dead_lettered`, and anything still owed a retry is
 * `pending`. So this predicate means "something here is finished and broken".
 *
 * `BroadcastFanoutBadge` in `StatusBadge.tsx` is the rendering counterpart of
 * the same fact and paints both as Lamp Cut, keeping the cross and the slash
 * apart so the two remain distinguishable without color. The invariant to hold
 * on to: a Broadcast this predicate calls a failure must never be one that
 * badge paints as healthy. They drifted apart once, and the filtered view
 * filled with green check lamps sitting above red Deliveries.
 */
export function fanoutHasFailure(fanout: FanoutSummary): boolean {
  return fanout.failed > 0 || fanout.deadLettered > 0;
}

/**
 * Where the Channel directory's health badge navigates (issue #51): a Channel
 * with recent failures lands directly on the filtered Activity view, so the
 * count the directory names and the failures behind it are one navigation
 * apart, per PRODUCT.md's "one navigation path (not a search)" rule. A
 * Channel with nothing failing keeps today's behavior — straight to the
 * Channel, unfiltered.
 *
 * Links by slug, not id (issue #56): the directory is where an operator reads
 * a Channel's human-facing name, and that is the one rule this codebase
 * applies everywhere a new Channel link gets minted — see `channelRef.ts`.
 * The id form still resolves (`ChannelDetailPage` accepts both), so a UUID
 * already pasted elsewhere keeps working; this function just never mints one.
 */
export function channelActivityHref(channel: {
  slug: string;
  recentFailedDeliveryCount: number;
}): string {
  if (channel.recentFailedDeliveryCount > 0) {
    return `/channels/${channel.slug}/activity${activityFilterSearch("failed")}`;
  }
  return `/channels/${channel.slug}`;
}
