import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { ChevronDown, ChevronRight, Filter } from "lucide-react";
import type { BroadcastListItem, EndpointFailure } from "@webhook-broadcast/contract";
import { ElapsedTime } from "../../components/ElapsedTime.js";
import { EmptyState } from "../../components/EmptyState.js";
import { InlineLoadError } from "../../components/InlineLoadError.js";
import { SkeletonRows } from "../../components/SkeletonRows.js";
import {
  DeliveryStatusLamp,
  EndpointFailureLamp,
  StatusLamp,
} from "../../components/StatusLamp.js";
import {
  ACTIVITY_ENDPOINT_PARAM,
  expandedEndpointIdsFromParams,
  expandedEndpointIdsToSearchValue,
} from "../../lib/activityFilter.js";
import { api, describeApiError } from "../../lib/api.js";
import { formatDeliveryCause } from "../../lib/deliveryCause.js";
import { useDelayedPending } from "../../lib/delayedPending.js";
import {
  freshnessRefetchInterval,
  queryErrorMessage,
  useRefetchOnVisible,
} from "../../lib/freshness.js";
import { handleRowListKeyDown } from "../../lib/rowListKeyboard.js";
import { BroadcastDetailPanel } from "./BroadcastDetailPanel.js";

/**
 * The roll-up query, defined once and shared: `ChannelActivityTab` observes the
 * same cache entry to render this view's freshness line in the position every
 * other polled list on the page keeps it (directly under the region heading,
 * above the controls), and observing by key means it reads that poll rather
 * than starting a second one.
 */
export function channelFailureRollupQueryOptions(channelId: string) {
  return {
    queryKey: ["channel-failures", channelId] as const,
    queryFn: () => api.listChannelFailures(channelId),
    refetchInterval: freshnessRefetchInterval,
  };
}

/** One Endpoint's failing Broadcasts, fetched lazily and paginated within the group. */
function EndpointFailureChildren({
  channelId,
  endpointId,
  expandedBroadcastId,
  onToggleBroadcast,
}: {
  channelId: string;
  endpointId: string;
  expandedBroadcastId: string | null;
  onToggleBroadcast: (broadcastId: string) => void;
}) {
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreLabel = useDelayedPending(loadingMore);
  const [extraItems, setExtraItems] = useState<BroadcastListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  const childrenQuery = useQuery({
    queryKey: ["endpoint-failures", channelId, endpointId] as const,
    queryFn: () => api.listBroadcasts(channelId, { endpointId, status: "failed" }),
    refetchInterval: freshnessRefetchInterval,
  });
  useRefetchOnVisible(() => void childrenQuery.refetch());

  useEffect(() => {
    setExtraItems([]);
    setNextCursor(childrenQuery.data?.nextCursor ?? null);
  }, [childrenQuery.data]);

  const { dataUpdatedAt } = childrenQuery;
  useEffect(() => {
    if (dataUpdatedAt > 0) {
      setLoadMoreError(null);
    }
  }, [dataUpdatedAt]);

  const firstPage = childrenQuery.data?.items ?? null;
  const items = firstPage === null ? null : [...firstPage, ...extraItems];
  const queryError = childrenQuery.isError
    ? queryErrorMessage(childrenQuery.error, "Failed to load this Endpoint's failing Broadcasts")
    : null;
  const error = queryError ?? loadMoreError;
  const showSkeleton = useDelayedPending(items === null && !error);
  const retry = queryError ? () => void childrenQuery.refetch() : () => void handleLoadMore();

  async function handleLoadMore(): Promise<void> {
    if (!nextCursor) {
      return;
    }
    setLoadingMore(true);
    try {
      const page = await api.listBroadcasts(channelId, {
        endpointId,
        status: "failed",
        cursor: nextCursor,
      });
      setExtraItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
      setLoadMoreError(null);
    } catch (err) {
      setLoadMoreError(
        describeApiError(err, "Failed to load more of this Endpoint's failing Broadcasts"),
      );
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <>
      {showSkeleton && <SkeletonRows count={2} label="Loading failing Broadcasts" />}
      {!showSkeleton && error && <InlineLoadError message={error} onRetry={retry} />}
      {!showSkeleton && items !== null && items.length === 0 && (
        <p className="muted group-cleared">No failures in the last 24 hours.</p>
      )}
      {!showSkeleton && items !== null && items.length > 0 && (
        <>
          <ul className="row-list row-list-failure-children" onKeyDown={handleRowListKeyDown}>
            {items.map((item) => {
              const expanded = expandedBroadcastId === item.id;
              return (
                <li
                  key={item.id}
                  onKeyDown={(event) => {
                    if (event.key === "Escape" && expanded) {
                      event.stopPropagation();
                      const rowButton =
                        event.currentTarget.querySelector<HTMLButtonElement>(".row-failure-child");
                      onToggleBroadcast(item.id);
                      rowButton?.focus();
                    }
                  }}
                >
                  <button
                    type="button"
                    className="row row-failure-child"
                    data-row-nav="true"
                    aria-expanded={expanded}
                    onClick={() => onToggleBroadcast(item.id)}
                  >
                    {item.delivery ? (
                      <DeliveryStatusLamp status={item.delivery.status} />
                    ) : (
                      // Contractually always present when the list is
                      // filtered by endpointId+status (see `broadcastListItemSchema`);
                      // this branch only guards a response that somehow omitted
                      // it. It still renders a full lamp rather than an empty
                      // cell: PRODUCT.md's "status is never encoded in color
                      // alone" needs a legend in every branch, and "unknown" is
                      // a reading an operator can act on where a blank column
                      // is not.
                      <StatusLamp
                        label="Status unavailable"
                        tone="neutral"
                        form="hollow"
                        glyph="none"
                      />
                    )}
                    <ElapsedTime
                      iso={item.receivedAt}
                      className="activity-time"
                      focusable={false}
                    />
                    <span className="activity-preview">{item.bodyPreview || "(empty body)"}</span>
                    <span className="muted failure-child-cause">
                      {item.delivery ? formatDeliveryCause(item.delivery) : ""}
                    </span>
                    <span className="muted activity-fanout">
                      {expanded ? (
                        <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />
                      ) : (
                        <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" />
                      )}
                    </span>
                  </button>
                  {expanded && (
                    <BroadcastDetailPanel
                      channelId={channelId}
                      broadcastId={item.id}
                      onActivityChanged={() => void childrenQuery.refetch()}
                    />
                  )}
                </li>
              );
            })}
          </ul>
          {nextCursor && (
            <div className="back-bar">
              <button
                type="button"
                className="control"
                onClick={() => void handleLoadMore()}
                disabled={loadingMore}
              >
                {loadingMoreLabel ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}

/** One collapsible Endpoint group: the header always renders from the roll-up row; the body is the lazily-fetched children, unless the group has cleared. */
function EndpointFailureGroup({
  channelId,
  item,
  cleared,
  expanded,
  onToggle,
  expandedBroadcastId,
  onToggleBroadcast,
}: {
  channelId: string;
  item: EndpointFailure;
  cleared: boolean;
  expanded: boolean;
  onToggle: () => void;
  expandedBroadcastId: string | null;
  onToggleBroadcast: (broadcastId: string) => void;
}) {
  const name = item.endpointName ?? item.endpointUrl;
  return (
    <li>
      <button
        type="button"
        className="row row-failure-group"
        data-row-nav="true"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <EndpointFailureLamp item={item} cleared={cleared} />
        <span className="row-meta failure-group-name">{name}</span>
        <ElapsedTime iso={item.lastFailureAt} className="activity-time" focusable={false} />
        <span className="muted activity-fanout">
          {expanded ? (
            <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" />
          )}
        </span>
      </button>
      {expanded && cleared && (
        <p className="muted group-cleared">No failures in the last 24 hours.</p>
      )}
      {expanded && !cleared && (
        <div className="well well-failure-group">
          <EndpointFailureChildren
            channelId={channelId}
            endpointId={item.endpointId}
            expandedBroadcastId={expandedBroadcastId}
            onToggleBroadcast={onToggleBroadcast}
          />
        </div>
      )}
    </li>
  );
}

/**
 * The reactive path of Channel Activity (issue #98, ADR 0004 amended):
 * severity-ranked Endpoint groups from `GET /channels/{id}/failures`, in the
 * order the server returns — never re-sorted client-side — each expandable
 * into that Endpoint's failing Broadcasts.
 *
 * Expansion is URL-owned (`?endpoint=<id>,<id>`), same as every other
 * expansion state on this page (#42, #56): absent opens the top-ranked group
 * with zero clicks, present-and-empty means the operator collapsed
 * everything, and any explicit toggle always writes the full set back —
 * see `activityFilter.ts`.
 *
 * A group the operator has expanded is never removed from view just because
 * its in-window count reached zero: `lastKnownRef` retains the last roll-up
 * row seen for every Endpoint, so a group that drops out of the server's
 * response (which only ever lists Endpoints with a current in-window
 * failure) still renders — as "No failures in the last 24 hours" rather than
 * disappearing — for as long as it stays expanded. Collapsing it, or a fresh
 * page load with it absent from the URL, is what actually drops it.
 */
export function ChannelFailuresByEndpoint({
  channelId,
  expandedBroadcastId,
  onToggleBroadcast,
}: {
  channelId: string;
  expandedBroadcastId: string | null;
  onToggleBroadcast: (broadcastId: string) => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const hasExplicitEndpointParam = searchParams.has(ACTIVITY_ENDPOINT_PARAM);
  const explicitExpanded = expandedEndpointIdsFromParams(searchParams);

  const rollupQuery = useQuery(channelFailureRollupQueryOptions(channelId));
  useRefetchOnVisible(() => void rollupQuery.refetch());

  const lastKnownRef = useRef<Map<string, EndpointFailure>>(new Map());
  useEffect(() => {
    if (rollupQuery.data) {
      for (const item of rollupQuery.data.items) {
        lastKnownRef.current.set(item.endpointId, item);
      }
    }
  }, [rollupQuery.data]);

  const liveItems = rollupQuery.data?.items ?? null;
  const liveIds = new Set((liveItems ?? []).map((item) => item.endpointId));

  // The "absent → top-ranked group opens" default (issue #98) is decided
  // once per mount, the first time the roll-up loads with no explicit
  // `?endpoint=` param, and then held — not re-derived every render off
  // whatever is *currently* top-ranked. Re-deriving it live would undo the
  // very guarantee this view makes elsewhere: the moment the default-opened
  // group's count reached zero and it dropped off the live top of the list,
  // a live re-derivation would compute a *different* (or no) default and the
  // group would vanish instead of clearing in place.
  //
  // The latch is taken during render, not in an effect. A ref assignment
  // schedules no re-render of its own, so latching it in an effect would leave
  // the render that first saw the roll-up showing every group collapsed, and
  // the default would only appear whenever some unrelated state change
  // happened to re-render — the next poll, or nothing at all. Writing it here
  // is idempotent (same data in, same id out) and lands in the same render
  // that reads it.
  const defaultOpenIdRef = useRef<string | null>(null);
  if (!hasExplicitEndpointParam && defaultOpenIdRef.current === null && liveItems) {
    defaultOpenIdRef.current = liveItems[0]?.endpointId ?? null;
  }

  const expandedIds = hasExplicitEndpointParam
    ? (explicitExpanded ?? new Set<string>())
    : new Set<string>(defaultOpenIdRef.current ? [defaultOpenIdRef.current] : []);

  // Any Endpoint still expanded whose in-window count reached zero (so the
  // server no longer lists it) but that this session has seen before: kept
  // rendered, cleared, at the end of the ranked list.
  const clearedItems =
    liveItems === null
      ? []
      : [...expandedIds]
          .filter((id) => !liveIds.has(id) && lastKnownRef.current.has(id))
          .map((id) => lastKnownRef.current.get(id))
          .filter((item): item is EndpointFailure => item !== undefined);
  const displayItems = liveItems === null ? null : [...liveItems, ...clearedItems];

  const error = rollupQuery.isError
    ? queryErrorMessage(rollupQuery.error, "Failed to load the failure roll-up")
    : null;
  const showSkeleton = useDelayedPending(displayItems === null && !error);

  function toggleGroup(endpointId: string): void {
    const next = new Set(expandedIds);
    if (next.has(endpointId)) {
      next.delete(endpointId);
    } else {
      next.add(endpointId);
    }
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        params.set(ACTIVITY_ENDPOINT_PARAM, expandedEndpointIdsToSearchValue(next));
        return params;
      },
      { replace: true },
    );
  }

  return (
    <>
      {/* Scopes the window this roll-up reports over — the count is
          server-side now (issue #98), so there is nothing to load further
          back, unlike the flat log's keyset pagination. */}
      <p className="muted activity-window-note">Failures shown are from the last 24 hours.</p>
      {showSkeleton && <SkeletonRows count={3} label="Loading failures by Endpoint" />}
      {!showSkeleton && error && (
        <InlineLoadError message={error} onRetry={() => void rollupQuery.refetch()} />
      )}
      {!showSkeleton && displayItems !== null && displayItems.length === 0 && (
        <EmptyState icon={<Filter size={20} strokeWidth={1.5} />}>
          No failed or dead-lettered Deliveries in the last 24 hours.
        </EmptyState>
      )}
      {!showSkeleton && displayItems !== null && displayItems.length > 0 && (
        <ul className="row-list row-list-failure-groups" onKeyDown={handleRowListKeyDown}>
          {displayItems.map((item) => (
            <EndpointFailureGroup
              key={item.endpointId}
              channelId={channelId}
              item={item}
              cleared={!liveIds.has(item.endpointId)}
              expanded={expandedIds.has(item.endpointId)}
              onToggle={() => toggleGroup(item.endpointId)}
              expandedBroadcastId={expandedBroadcastId}
              onToggleBroadcast={onToggleBroadcast}
            />
          ))}
        </ul>
      )}
    </>
  );
}
