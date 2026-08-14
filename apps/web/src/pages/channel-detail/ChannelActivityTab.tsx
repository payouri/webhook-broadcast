import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { ChevronDown, ChevronRight, Filter, Inbox } from "lucide-react";
import type { BroadcastListItem } from "@webhook-broadcast/contract";
import { ElapsedTime } from "../../components/ElapsedTime.js";
import { EmptyState } from "../../components/EmptyState.js";
import { InlineLoadError } from "../../components/InlineLoadError.js";
import { PollStatusLine } from "../../components/PollStatusLine.js";
import { ShortcutsHelp } from "../../components/ShortcutsHelp.js";
import { SkeletonRows } from "../../components/SkeletonRows.js";
import { BroadcastFanoutBadge } from "../../components/StatusBadge.js";
import {
  ACTIVITY_FILTER_PARAM,
  activityFilterFromParams,
  fanoutHasFailure,
  type ActivityFilter,
} from "../../lib/activityFilter.js";
import { api, describeApiError } from "../../lib/api.js";
import { useDelayedPending } from "../../lib/delayedPending.js";
import {
  freshnessRefetchInterval,
  queryErrorMessage,
  useRefetchOnVisible,
} from "../../lib/freshness.js";
import { handleRowListKeyDown } from "../../lib/rowListKeyboard.js";
import { BroadcastDetailPanel } from "./BroadcastDetailPanel.js";

const ACTIVITY_SHORTCUTS = [
  { keys: "↑ ↓", description: "Move between Broadcast rows, or Delivery rows inside one" },
  { keys: "Home / End", description: "Jump to the first or last row of the list you are in" },
  { keys: "Enter / Space", description: "Expand or collapse the focused Broadcast or Delivery" },
  {
    keys: "Esc",
    description: "Collapse the open Broadcast or Delivery, or back out of a confirmation",
  },
] as const;

/**
 * States its current option at rest — the active choice carries the accent as
 * text, border, and ground, plus a heavier weight, not something discovered by
 * hovering. `aria-pressed` carries the same fact for assistive tech, and the CSS
 * keys the active look off that attribute rather than a parallel class, so the
 * two can never disagree.
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
        className="control control-filter"
        aria-pressed={filter === "all"}
        onClick={() => onChange("all")}
      >
        All
      </button>
      <button
        type="button"
        className="control control-filter"
        aria-pressed={filter === "failed"}
        onClick={() => onChange("failed")}
      >
        <Filter size={13} strokeWidth={1.75} aria-hidden="true" />
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
  const loadingMoreLabel = useDelayedPending(loadingMore);
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
      setLoadMoreError(describeApiError(err, "Failed to load more Activity"));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    // A list-only region: the filter and "Load more" are controls over the list,
    // not prose or a form, so this stays unwrapped like Channels/Endpoints — and
    // at full tabular width, since this is the busiest list in the product.
    <section className="list-section">
      {/* The tab strip immediately above already reads ACTIVITY, and this is the
          tab's only section, so a visible legend here would state the same word
          twice, 40px apart, under two near-identical scored rules. The heading
          stays in the outline for assistive tech, where it is not a repeat but
          the only thing naming this region. */}
      <h2 className="visually-hidden">Activity</h2>
      {/* The poll's own freshness reading sits directly under the region's
          heading, as it does on the Channel directory and Endpoints lists,
          above the controls that act on the list. */}
      <PollStatusLine dataUpdatedAt={activityQuery.dataUpdatedAt} isError={activityQuery.isError} />
      <div className="activity-controls">
        <ActivityFilterToggle filter={filter} onChange={setFilter} />
      </div>
      {error && <InlineLoadError message={error} onRetry={retry} />}
      {items === null && !error && <SkeletonRows count={4} label="Loading Activity" />}
      {items !== null && items.length === 0 && (
        <EmptyState icon={<Inbox size={20} strokeWidth={1.5} />}>
          No Broadcasts yet. Send a request to <code>POST /ingest/&lt;slug&gt;</code> with a Channel
          token.
        </EmptyState>
      )}
      {items !== null && items.length > 0 && visibleItems !== null && (
        <>
          {visibleItems.length === 0 ? (
            <EmptyState icon={<Filter size={20} strokeWidth={1.5} />}>
              No Broadcasts in the loaded Activity have a failed or dead-lettered Delivery.
              {nextCursor ? " Load more to look further back." : ""}
            </EmptyState>
          ) : (
            <ul className="row-list row-list-activity" onKeyDown={handleRowListKeyDown}>
              {visibleItems.map((item) => {
                const expanded = expandedBroadcastId === item.id;
                return (
                  <li
                    key={item.id}
                    onKeyDown={(event) => {
                      // Escape collapses the open Broadcast wherever focus
                      // landed inside its well — the Attempt list, a Retry
                      // button — and hands focus back to the row that opened
                      // it, rather than stranding it on an element that is
                      // about to unmount.
                      if (event.key === "Escape" && expanded) {
                        event.stopPropagation();
                        const rowButton =
                          event.currentTarget.querySelector<HTMLButtonElement>(".row-activity");
                        onToggleBroadcast(item.id);
                        rowButton?.focus();
                      }
                    }}
                  >
                    <button
                      type="button"
                      className="row row-activity"
                      data-row-nav="true"
                      aria-expanded={expanded}
                      onClick={() => onToggleBroadcast(item.id)}
                    >
                      {/* The one row family that had no status element at all: a
                          dead-lettered fan-out used to render as the same muted
                          grey as the timestamp beside it. This lamp lands in the
                          same fixed leading column as every other row's. */}
                      <BroadcastFanoutBadge fanout={item.fanout} />
                      {/* `focusable={false}`: this row is itself the button, so the
                          exact instant is revealed from the row's own focus rather
                          than from a second tab stop nested inside it. */}
                      <ElapsedTime
                        iso={item.receivedAt}
                        className="activity-time"
                        focusable={false}
                      />
                      <span className="activity-preview">{item.bodyPreview || "(empty body)"}</span>
                      {/* No trailing fan-out text: the lamp in the leading column
                          already states it, word for word ("3/4 SUCCEEDED"), and
                          printing it twice per row is the loudest repetition on
                          the busiest list in the product. What is left here is
                          the one thing the lamp cannot say: whether this row
                          opens, and whether it is open now. */}
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
                        onActivityChanged={() => void activityQuery.refetch()}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
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
      {/* Last in the section (issue #79): the trigger no longer shares a
          `justify-content: space-between` row with the filter toggle, and
          nothing sits below it, so opening it can never move the trigger or
          displace the filter row or the rows above. */}
      <div className="list-shortcuts">
        <ShortcutsHelp items={ACTIVITY_SHORTCUTS} />
      </div>
    </section>
  );
}
