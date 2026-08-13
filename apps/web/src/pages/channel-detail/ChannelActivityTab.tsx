import { useCallback, useState } from "react";
import type { BroadcastListItem } from "@webhook-broadcast/contract";
import { InlineLoadError } from "../../components/InlineLoadError.js";
import { api } from "../../lib/api.js";
import { usePolling } from "../../lib/freshness.js";
import { BroadcastDetailPanel } from "./BroadcastDetailPanel.js";

function fanoutLabel(fanout: BroadcastListItem["fanout"]): string {
  if (fanout.total === 0) {
    return "no Endpoints yet";
  }
  return `${fanout.succeeded}/${fanout.total} succeeded${
    fanout.deadLettered > 0 ? `, ${fanout.deadLettered} dead-lettered` : ""
  }`;
}

/** Channel Activity (ADR 0004): newest-first Broadcasts, ~5s poll, cursor "load more". */
export function ChannelActivityTab({ channelId }: { channelId: string }) {
  const [items, setItems] = useState<BroadcastListItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadFirstPage = useCallback(async () => {
    try {
      const page = await api.listBroadcasts(channelId);
      setItems(page.items);
      setNextCursor(page.nextCursor);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Activity");
    }
  }, [channelId]);

  usePolling(loadFirstPage);

  async function handleLoadMore(): Promise<void> {
    if (!nextCursor) {
      return;
    }
    setLoadingMore(true);
    try {
      const page = await api.listBroadcasts(channelId, nextCursor);
      setItems((current) => [...(current ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more Activity");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section className="card">
      <h2>Activity</h2>
      {error && <InlineLoadError message={error} onRetry={loadFirstPage} />}
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
                  aria-expanded={expandedId === item.id}
                  onClick={() => setExpandedId((current) => (current === item.id ? null : item.id))}
                >
                  <span className="activity-time">
                    {new Date(item.receivedAt).toLocaleString()}
                  </span>
                  <span className="activity-preview">{item.bodyPreview || "(empty body)"}</span>
                  <span className="muted activity-fanout">{fanoutLabel(item.fanout)}</span>
                </button>
                {expandedId === item.id && (
                  <BroadcastDetailPanel
                    channelId={channelId}
                    broadcastId={item.id}
                    onReplayed={() => void loadFirstPage()}
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
