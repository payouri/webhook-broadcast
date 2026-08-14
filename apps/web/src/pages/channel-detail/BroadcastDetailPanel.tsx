import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Inbox, RotateCcw } from "lucide-react";
import { EmptyState } from "../../components/EmptyState.js";
import { InlineLoadError } from "../../components/InlineLoadError.js";
import { SkeletonRows } from "../../components/SkeletonRows.js";
import { api, describeApiError } from "../../lib/api.js";
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
      setReplayError(describeApiError(err, "Failed to replay Broadcast"));
    } finally {
      setReplaying(false);
    }
  }

  return (
    <div className="well well-broadcast">
      {error && <InlineLoadError message={error} onRetry={() => void broadcastQuery.refetch()} />}
      {!detail && !error && <SkeletonRows count={2} label="Loading Broadcast" />}
      {detail && (
        <>
          <p className="muted broadcast-detail-content-type">{detail.contentType}</p>
          <pre className="payload data">{detail.body || "(empty body)"}</pre>

          {/* Replay (issue #22): re-fans the stored payload out to Endpoints
              enabled right now; no new ingest needed. */}
          <div className="broadcast-replay">
            <button
              type="button"
              className="control"
              onClick={() => void handleReplay()}
              disabled={replaying}
            >
              <RotateCcw size={13} strokeWidth={1.75} aria-hidden="true" />
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
            <EmptyState icon={<Inbox size={20} strokeWidth={1.5} />}>
              No Endpoints were enabled on this Channel when the Broadcast was accepted.
            </EmptyState>
          ) : (
            <ul className="row-list row-list-tight">
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
