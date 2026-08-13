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

/** True when a Broadcast's fan-out produced at least one failed or dead-lettered Delivery. */
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
 */
export function channelActivityHref(channel: {
  id: string;
  recentFailedDeliveryCount: number;
}): string {
  if (channel.recentFailedDeliveryCount > 0) {
    return `/channels/${channel.id}/activity${activityFilterSearch("failed")}`;
  }
  return `/channels/${channel.id}`;
}
