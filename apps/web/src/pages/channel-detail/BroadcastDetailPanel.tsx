import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { InlineLoadError } from "../../components/InlineLoadError.js";
import { api } from "../../lib/api.js";
import {
  freshnessRefetchInterval,
  queryErrorMessage,
  useRefetchOnVisible,
} from "../../lib/freshness.js";
import { DeliveryDetail } from "../DeliveryDetail.js";

/** Broadcast detail (issue #19): inbound payload plus every fanned-out Delivery. */
export function BroadcastDetailPanel({
  channelId,
  broadcastId,
  onReplayed,
}: {
  channelId: string;
  broadcastId: string;
  onReplayed?: () => void;
}) {
  const [replaying, setReplaying] = useState(false);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [replayedId, setReplayedId] = useState<string | null>(null);

  const broadcastQuery = useQuery({
    queryKey: ["broadcast-detail", channelId, broadcastId] as const,
    queryFn: () => api.getBroadcastDetail(channelId, broadcastId),
    refetchInterval: freshnessRefetchInterval,
  });
  useRefetchOnVisible(() => void broadcastQuery.refetch());

  const detail = broadcastQuery.data ?? null;
  const error = broadcastQuery.isError
    ? queryErrorMessage(broadcastQuery.error, "Failed to load Broadcast")
    : null;

  async function handleReplay(): Promise<void> {
    setReplaying(true);
    setReplayError(null);
    try {
      const { id } = await api.replayBroadcast(channelId, broadcastId);
      setReplayedId(id);
      onReplayed?.();
    } catch (err) {
      setReplayError(err instanceof Error ? err.message : "Failed to replay Broadcast");
    } finally {
      setReplaying(false);
    }
  }

  return (
    <div className="broadcast-detail">
      {error && <InlineLoadError message={error} onRetry={() => void broadcastQuery.refetch()} />}
      {!detail && !error && <p className="muted">Loading…</p>}
      {detail && (
        <>
          <p className="muted broadcast-detail-content-type">{detail.contentType}</p>
          <pre className="broadcast-body">{detail.body || "(empty body)"}</pre>

          {/* Replay (issue #22): re-fans the stored payload out to Endpoints
              enabled right now; no new ingest needed. */}
          <div className="broadcast-replay">
            <button
              type="button"
              className="button-ghost"
              onClick={() => void handleReplay()}
              disabled={replaying}
            >
              {replaying ? "Replaying…" : "Replay"}
            </button>
            {replayError && (
              <span className="error-text" role="alert">
                {replayError}
              </span>
            )}
            {replayedId && !replayError && (
              <span className="success-text">Replayed. See it in Activity.</span>
            )}
          </div>

          {detail.deliveries.length === 0 ? (
            <p className="muted empty-state">
              No Endpoints were enabled on this Channel when the Broadcast was accepted.
            </p>
          ) : (
            <ul className="delivery-list">
              {detail.deliveries.map((delivery) => (
                <DeliveryDetail
                  key={delivery.id}
                  delivery={delivery}
                  onRetried={() => void broadcastQuery.refetch()}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
