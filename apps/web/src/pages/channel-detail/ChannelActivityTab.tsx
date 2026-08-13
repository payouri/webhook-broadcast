import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BroadcastListItem } from "@webhook-broadcast/contract";
import { InlineLoadError } from "../../components/InlineLoadError.js";
import { api } from "../../lib/api.js";
import { FRESHNESS_POLL_MS, queryErrorMessage } from "../../lib/freshness.js";
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
    refetchInterval: FRESHNESS_POLL_MS,
  });

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
    <section className="card">
      <h2>Activity</h2>
      {error && <InlineLoadError message={error} onRetry={retry} />}
      {items === null && !error && <p className="muted">Loading…</p>}
      {items !== null && items.length === 0 && (
        <p className="muted empty-state">
          No Broadcasts yet — send a request to <code>POST /ingest/&lt;slug&gt;</code> with a
          Channel token.
        </p>
      )}
      {items !== null && items.length > 0 && (
        <>
          <ul className="activity-list">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="activity-row"
                  aria-expanded={expandedBroadcastId === item.id}
                  onClick={() => onToggleBroadcast(item.id)}
                >
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
