import { useCallback, useEffect, useState } from "react";
import type { BroadcastDetail } from "@webhook-broadcast/contract";
import { InlineLoadError } from "../../components/InlineLoadError.js";
import { api } from "../../lib/api.js";
import { usePolling } from "../../lib/freshness.js";
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
  const [detail, setDetail] = useState<BroadcastDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [replayedId, setReplayedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.getBroadcastDetail(channelId, broadcastId);
      setDetail(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Broadcast");
    }
  }, [channelId, broadcastId]);

  useEffect(() => {
    setDetail(null);
    setError(null);
  }, [channelId, broadcastId]);

  usePolling(load);

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
      {error && <InlineLoadError message={error} onRetry={load} />}
      {!detail && !error && <p className="muted">Loading…</p>}
      {detail && (
        <>
          <p className="muted broadcast-detail-content-type">{detail.contentType}</p>
          <pre className="broadcast-body">{detail.body || "(empty body)"}</pre>

          {/* Replay (issue #22): re-fans the stored payload out to Endpoints
              enabled right now — no new ingest needed. */}
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
              <span className="success-text">Replayed — see it in Activity.</span>
            )}
          </div>

          {detail.deliveries.length === 0 ? (
            <p className="muted empty-state">
              No Endpoints were enabled on this Channel when the Broadcast was accepted.
            </p>
          ) : (
            <ul className="delivery-list">
              {detail.deliveries.map((delivery) => (
                <DeliveryDetail key={delivery.id} delivery={delivery} onRetried={load} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
