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
import { BroadcastFanoutLamp } from "../../components/StatusLamp.js";
import {
  ACTIVITY_FILTER_PARAM,
  activityFilterFromParams,
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
import {
  ChannelFailuresByEndpoint,
  channelFailureRollupQueryOptions,
} from "./ChannelFailuresByEndpoint.js";

const ALL_BROADCASTS_SHORTCUTS = [
  { keys: "↑ ↓", description: "Move between Broadcast rows, or Delivery rows inside one" },
  { keys: "Home / End", description: "Jump to the first or last row of the list you are in" },
  { keys: "Enter / Space", description: "Expand or collapse the focused Broadcast or Delivery" },
  {
    keys: "Esc",
    description: "Collapse the open Broadcast or Delivery, or back out of a confirmation",
  },
] as const;

const FAILURES_BY_ENDPOINT_SHORTCUTS = [
  { keys: "↑ ↓", description: "Move between Endpoint groups, or Broadcast rows inside one" },
  { keys: "Home / End", description: "Jump to the first or last row of the list you are in" },
  {
    keys: "Enter / Space",
    description: "Expand or collapse the focused Endpoint group or Broadcast",
  },
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
 *
 * Relabelled from "All" / "Failures only" (issue #98): the control stopped
 * filtering which rows of one list show up and started choosing between two
 * different structures over the same Channel — the flat chronological log, or
 * that same fan-out re-shaped into one group per broken Endpoint — so its
 * labels now name structures rather than a filter predicate.
 */
function ActivityFilterToggle({
  filter,
  onChange,
}: {
  filter: ActivityFilter;
  onChange: (next: ActivityFilter) => void;
}) {
  return (
    <div className="activity-filter" role="group" aria-label="Choose the Activity view">
      <button
        type="button"
        className="control control-filter"
        aria-pressed={filter === "all"}
        onClick={() => onChange("all")}
      >
        All Broadcasts
      </button>
      <button
        type="button"
        className="control control-filter"
        aria-pressed={filter === "failed"}
        onClick={() => onChange("failed")}
      >
        <Filter size={13} strokeWidth={1.75} aria-hidden="true" />
        Failures by Endpoint
      </button>
    </div>
  );
}

/**
 * Channel Activity (ADR 0004, amended for issue #98): the toggle chooses
 * between the proactive path — a flat, newest-first, cursor-paginated
 * Broadcast log, unchanged from before this issue — and the reactive path,
 * `ChannelFailuresByEndpoint`'s severity-ranked Endpoint roll-up. Both share
 * the expanded-Broadcast URL segment (issue #42) and this tab's ~5s poll
 * convention; only the "all" branch still filters/paginates over
 * `GET /channels/{id}/broadcasts` directly; the "failed" branch owns its own
 * data fetching entirely (`GET /channels/{id}/failures` plus per-group
 * `GET /channels/{id}/broadcasts?endpointId=…&status=failed`).
 */
export function ChannelActivityTab({
  channelId,
  channelSlug,
  expandedBroadcastId,
  onToggleBroadcast,
}: {
  channelId: string;
  channelSlug: string;
  expandedBroadcastId: string | null;
  onToggleBroadcast: (broadcastId: string) => void;
}) {
  // The filter lives in the URL (issue #51), consistent with #42's treatment of
  // the Channel, tab, and expanded Broadcast: a reload or a shared link lands
  // on the same view.
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
    // The flat log only ever needs fetching while it is the visible branch —
    // the roll-up, when active, owns its own queries instead.
    enabled: filter === "all",
  });
  useRefetchOnVisible(() => {
    if (filter === "all") {
      void activityQuery.refetch();
    }
  });

  // Observes the roll-up's cache entry by key rather than starting a poll of
  // its own — `ChannelFailuresByEndpoint` runs it — purely so the freshness
  // line above can report whichever query drives the visible structure.
  const rollupPoll = useQuery({
    ...channelFailureRollupQueryOptions(channelId),
    enabled: filter === "failed",
  });
  const visibleQuery = filter === "failed" ? rollupPoll : activityQuery;

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
  const queryError = activityQuery.isError
    ? queryErrorMessage(activityQuery.error, "Failed to load Activity")
    : null;
  // Whichever failure is on screen is the one Retry must re-run.
  const error = queryError ?? loadMoreError;
  // The skeleton's own delay-and-hold (DESIGN.md §5): shown only past the
  // 250ms delay, and once shown, held for its 400ms minimum before whatever
  // comes next — the loaded list, an empty state, or the error above — is
  // allowed to replace it.
  const showSkeleton = useDelayedPending(items === null && !error);
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
      const page = await api.listBroadcasts(channelId, { cursor: nextCursor });
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
          above the controls that act on the list — and it stays there on both
          branches. Each reads whichever query is actually driving the visible
          list, so switching structure never leaves a failing poll reading as a
          quiet system (issue #54). */}
      <PollStatusLine dataUpdatedAt={visibleQuery.dataUpdatedAt} isError={visibleQuery.isError} />

      <div className="activity-controls">
        <ActivityFilterToggle filter={filter} onChange={setFilter} />
      </div>
      {filter === "failed" ? (
        <ChannelFailuresByEndpoint
          channelId={channelId}
          expandedBroadcastId={expandedBroadcastId}
          onToggleBroadcast={onToggleBroadcast}
        />
      ) : (
        <>
          {showSkeleton && <SkeletonRows count={4} label="Loading Activity" />}
          {!showSkeleton && error && <InlineLoadError message={error} onRetry={retry} />}
          {!showSkeleton && items !== null && items.length === 0 && (
            <EmptyState icon={<Inbox size={20} strokeWidth={1.5} />}>
              No Broadcasts yet. Send a request to <code>POST /ingest/{channelSlug}</code> with a
              Channel token.
            </EmptyState>
          )}
          {!showSkeleton && items !== null && items.length > 0 && (
            <>
              <ul className="row-list row-list-activity" onKeyDown={handleRowListKeyDown}>
                {items.map((item) => {
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
                        <BroadcastFanoutLamp fanout={item.fanout} />
                        {/* `focusable={false}`: this row is itself the button, so the
                            exact instant is revealed from the row's own focus rather
                            than from a second tab stop nested inside it. */}
                        <ElapsedTime
                          iso={item.receivedAt}
                          className="activity-time"
                          focusable={false}
                        />
                        <span className="activity-preview">
                          {item.bodyPreview || "(empty body)"}
                        </span>
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
      )}
      {/* Last in the section (issue #79): the trigger no longer shares a
          `justify-content: space-between` row with the filter toggle, and
          nothing sits below it, so opening it can never move the trigger or
          displace the filter row or the rows above. */}
      <div className="list-shortcuts">
        <ShortcutsHelp
          items={filter === "failed" ? FAILURES_BY_ENDPOINT_SHORTCUTS : ALL_BROADCASTS_SHORTCUTS}
        />
      </div>
    </section>
  );
}
