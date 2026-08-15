/**
 * The Activity view's two structures (issue #98, ADR 0004 amended): "all" is
 * the proactive path, a flat newest-first Broadcast log; "failed" is the
 * reactive path, the same Channel's Deliveries re-shaped into one collapsible
 * group per broken Endpoint (`GET /channels/{id}/failures`, issue #84). The
 * toggle used to read "All" / "Failures only" over a client-side filter on
 * the loaded page (issue #51's `fanoutHasFailure`, which filtered row
 * membership without changing the list's shape) — 44 identical
 * `1 failed, 3/4 succeeded` rows are one broken Endpoint, and the reactive
 * path now says so instead of listing each occurrence. The URL param and its
 * values are unchanged (`?filter=failed`) so every existing link, including
 * the Channel directory's badge, still lands on the reactive path.
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
 * `?endpoint=<id>,<id>` (issue #98): which Endpoint groups are expanded on the
 * reactive path, multi-open and URL-owned like every other expansion state on
 * this page (#42, #56). Three states, not two:
 *
 * - the param is absent from the URL entirely → `null`, meaning "no explicit
 *   choice yet" — the caller defaults this to the top-ranked group, since the
 *   common case is a single broken Endpoint and it should read with zero
 *   clicks.
 * - the param is present but empty (`?endpoint=`) → an empty `Set`, meaning
 *   the operator collapsed everything. This must never fall back to the
 *   top-ranked default, or a deliberate collapse-all would spring back open
 *   on the very next render.
 * - the param carries one or more ids → exactly that `Set`.
 */
export const ACTIVITY_ENDPOINT_PARAM = "endpoint";

export function expandedEndpointIdsFromParams(searchParams: URLSearchParams): Set<string> | null {
  if (!searchParams.has(ACTIVITY_ENDPOINT_PARAM)) {
    return null;
  }
  const raw = searchParams.get(ACTIVITY_ENDPOINT_PARAM) ?? "";
  const ids = raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  return new Set(ids);
}

/**
 * Writes an explicit (possibly empty) expanded-group set into the URL. Once an
 * operator has toggled any group, the state is always written explicitly —
 * never left absent again — so a shared link reproduces exactly what they saw
 * rather than re-deriving a "top-ranked" default that may no longer be top.
 */
export function expandedEndpointIdsToSearchValue(ids: ReadonlySet<string>): string {
  return [...ids].join(",");
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
