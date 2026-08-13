import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import type { BroadcastListItem } from "@webhook-broadcast/contract";
import { InlineLoadError } from "../../components/InlineLoadError.js";
import { BroadcastFanoutBadge } from "../../components/StatusBadge.js";
import {
  ACTIVITY_FILTER_PARAM,
  activityFilterFromParams,
  fanoutHasFailure,
  type ActivityFilter,
} from "../../lib/activityFilter.js";
import { api } from "../../lib/api.js";
import {
  freshnessRefetchInterval,
  queryErrorMessage,
  useRefetchOnVisible,
} from "../../lib/freshness.js";
import { BroadcastDetailPanel } from "./BroadcastDetailPanel.js";

function fanoutLabel(fanout: BroadcastListItem["fanout"]): string {
  if (fanout.total === 0) {
    return "no Endpoints yet";
  }
  return `${fanout.succeeded}/${fanout.total} succeeded${
    fanout.deadLettered > 0 ? `, ${fanout.deadLettered} dead-lettered` : ""
  }`;
}

/**
 * States its current option at rest — the active choice carries Patch Plum text,
 * a Patch Plum border, and a heavier weight, not something discovered by
 * hovering (DESIGN.md §5: "Nothing is discovered by hovering"). `aria-pressed`
 * carries the same fact for assistive tech.
 */
function ActivityFilterToggle({
  filter,
  onChange,
}: {
  filter: ActivityFilter;
  onChange: (next: ActivityFilter) => void;
}) {
  return (
    <div className="activity-filter" role="group" aria-label="Filter Activity by Delivery status">
      <button
        type="button"
        className={`filter-toggle ${filter === "all" ? "filter-toggle-active" : ""}`}
        aria-pressed={filter === "all"}
        onClick={() => onChange("all")}
      >
        All
      </button>
      <button
        type="button"
        className={`filter-toggle ${filter === "failed" ? "filter-toggle-active" : ""}`}
        aria-pressed={filter === "failed"}
        onClick={() => onChange("failed")}
      >
        Failures only
      </button>
    </div>
  );
}

/**
 * Channel Activity (ADR 0004): newest-first Broadcasts, ~5s poll, cursor "load more".
 * The expanded Broadcast (issue #42) is controlled by the URL, not local state, so
 * it survives a reload and is part of any link the operator shares.
 */
export function ChannelActivityTab({
  channelId,
  expandedBroadcastId,
  onToggleBroadcast,
}: {
  channelId: string;
  expandedBroadcastId: string | null;
  onToggleBroadcast: (broadcastId: string) => void;
}) {
  // The filter lives in the URL (issue #51), consistent with #42's treatment of
  // the Channel, tab, and expanded Broadcast: a reload or a shared link lands
  // on the same filtered (or unfiltered) view.
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = activityFilterFromParams(searchParams);
  const setFilter = (next: ActivityFilter) => {
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        if (next === "failed") {
          params.set(ACTIVITY_FILTER_PARAM, "failed");
        } else {
          params.delete(ACTIVITY_FILTER_PARAM);
        }
        return params;
      },
      { replace: true },
    );
  };

  const [loadingMore, setLoadingMore] = useState(false);
  // Pages fetched beyond the polled first page — the ~5s refetch only ever
  // returns page one, so extra pages (and their cursor) live outside Query
  // and reset whenever a fresh first page arrives, same as before adoption.
  const [extraItems, setExtraItems] = useState<BroadcastListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  const activityQuery = useQuery({
    queryKey: ["broadcasts", channelId] as const,
    queryFn: () => api.listBroadcasts(channelId),
    refetchInterval: freshnessRefetchInterval,
  });
  useRefetchOnVisible(() => void activityQuery.refetch());

  useEffect(() => {
    setExtraItems([]);
    setNextCursor(activityQuery.data?.nextCursor ?? null);
  }, [activityQuery.data]);

  // A successful first-page fetch clears any stale "load more" failure, the way
  // the pre-Query effect cleared the one shared `error` on every poll. Keyed on
  // `dataUpdatedAt` (not `data`) so an unchanged page still counts as success.
  const { dataUpdatedAt } = activityQuery;
  useEffect(() => {
    if (dataUpdatedAt > 0) {
      setLoadMoreError(null);
    }
  }, [dataUpdatedAt]);

  const firstPage = activityQuery.data?.items ?? null;
  const items: BroadcastListItem[] | null =
    firstPage === null ? null : [...firstPage, ...extraItems];
  const visibleItems: BroadcastListItem[] | null =
    items === null
      ? null
      : filter === "failed"
        ? items.filter((item) => fanoutHasFailure(item.fanout))
        : items;
  const queryError = activityQuery.isError
    ? queryErrorMessage(activityQuery.error, "Failed to load Activity")
    : null;
  // Whichever failure is on screen is the one Retry must re-run.
  const error = queryError ?? loadMoreError;
  const retry = queryError
    ? () => void activityQuery.refetch()
    : () => {
        void handleLoadMore();
      };

  async function handleLoadMore(): Promise<void> {
    if (!nextCursor) {
      return;
    }
    setLoadingMore(true);
    try {
      const page = await api.listBroadcasts(channelId, nextCursor);
      setExtraItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
      setLoadMoreError(null);
    } catch (err) {
      setLoadMoreError(err instanceof Error ? err.message : "Failed to load more Activity");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    // A list-only region (issue #49): the filter toggle and "Load more"
    // button are controls over the list, not prose or a form, so this stays
    // unwrapped like Channels/Endpoints — and at full tabular width, since
    // this is the busiest list in the product.
    <section className="list-section">
      <h2 className="section-title">Activity</h2>
      <ActivityFilterToggle filter={filter} onChange={setFilter} />
      {error && <InlineLoadError message={error} onRetry={retry} />}
      {items === null && !error && <p className="muted">Loading…</p>}
      {items !== null && items.length === 0 && (
        <p className="muted empty-state">
          No Broadcasts yet. Send a request to <code>POST /ingest/&lt;slug&gt;</code> with a Channel
          token.
        </p>
      )}
      {items !== null && items.length > 0 && visibleItems !== null && (
        <>
          {visibleItems.length === 0 ? (
            <p className="muted empty-state">
              No Broadcasts in the loaded Activity have a failed or dead-lettered Delivery.
              {nextCursor ? " Load more to look further back." : ""}
            </p>
          ) : (
            <ul className="activity-list">
              {visibleItems.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="activity-row"
                    aria-expanded={expandedBroadcastId === item.id}
                    onClick={() => onToggleBroadcast(item.id)}
                  >
                    {/* The one row family that had no status element at all
                        (2026-08-13 critique): a dead-lettered fan-out used to
                        render as the same muted grey as the timestamp beside
                        it. This stamp lands in the same fixed leading column
                        as every other row's (`--status-stamp-column`). */}
                    <BroadcastFanoutBadge fanout={item.fanout} />
                    <span className="activity-time">
                      {new Date(item.receivedAt).toLocaleString()}
                    </span>
                    <span className="activity-preview">{item.bodyPreview || "(empty body)"}</span>
                    <span className="muted activity-fanout">{fanoutLabel(item.fanout)}</span>
                  </button>
                  {expandedBroadcastId === item.id && (
                    <BroadcastDetailPanel
                      channelId={channelId}
                      broadcastId={item.id}
                      onReplayed={() => void activityQuery.refetch()}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
          {nextCursor && (
            <button
              type="button"
              className="button-ghost"
              onClick={() => void handleLoadMore()}
              disabled={loadingMore}
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </>
      )}
    </section>
  );
}
