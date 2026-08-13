import { useState } from "react";
import type { Attempt, BroadcastDetail } from "@webhook-broadcast/contract";
import { DeliveryStatusBadge } from "../components/StatusBadge.js";
import { api } from "../lib/api.js";

type DeliveryItem = BroadcastDetail["deliveries"][number];

/**
 * Delivery detail (issue #21): Endpoint identity + status are already on the
 * `delivery` row from the Broadcast detail response; expanding fetches the
 * Attempt timeline, and a Retry action appears only once `dead_lettered`
 * (ADR 0003 — distinct from Broadcast Replay).
 */
export function DeliveryDetail({
  delivery,
  onRetried,
}: {
  delivery: DeliveryItem;
  onRetried: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [attempts, setAttempts] = useState<Attempt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  async function loadAttempts(): Promise<void> {
    try {
      const list = await api.listDeliveryAttempts(delivery.id);
      setAttempts(list.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Attempts");
    }
  }

  function toggle(): void {
    setExpanded((current) => {
      const next = !current;
      if (next) {
        setAttempts(null);
        void loadAttempts();
      }
      return next;
    });
  }

  async function handleRetry(): Promise<void> {
    setRetrying(true);
    setError(null);
    try {
      await api.retryDelivery(delivery.id);
      await loadAttempts();
      onRetried();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to retry Delivery");
    } finally {
      setRetrying(false);
    }
  }

  return (
    <li className="delivery-row-wrapper">
      <button type="button" className="delivery-row" aria-expanded={expanded} onClick={toggle}>
        <DeliveryStatusBadge status={delivery.status} />
        <span className="delivery-endpoint">{delivery.endpointName ?? delivery.endpointUrl}</span>
        <span className="muted delivery-meta">
          {delivery.lastStatusCode !== null ? `HTTP ${delivery.lastStatusCode}` : "—"}
          {delivery.lastDurationMs !== null ? ` · ${delivery.lastDurationMs}ms` : ""}
        </span>
      </button>

      {expanded && (
        <div className="delivery-detail">
          <p className="muted delivery-endpoint-url">{delivery.endpointUrl}</p>

          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          {delivery.lastError && !error && (
            <p className="error-text delivery-error">{delivery.lastError}</p>
          )}

          {attempts === null && !error && <p className="muted">Loading Attempts…</p>}
          {attempts !== null && attempts.length === 0 && (
            <p className="muted empty-state">No Attempts yet.</p>
          )}
          {attempts !== null && attempts.length > 0 && (
            <ul className="attempt-list">
              {attempts.map((attempt) => (
                <li key={attempt.id} className="attempt-row">
                  <span className="attempt-n">#{attempt.n}</span>
                  <span className="muted">{new Date(attempt.at).toLocaleString()}</span>
                  <span>{attempt.statusCode !== null ? `HTTP ${attempt.statusCode}` : "—"}</span>
                  <span className="muted">
                    {attempt.durationMs !== null ? `${attempt.durationMs}ms` : ""}
                  </span>
                  {attempt.error && <span className="error-text">{attempt.error}</span>}
                </li>
              ))}
            </ul>
          )}

          {delivery.status === "dead_lettered" && (
            <button type="button" onClick={() => void handleRetry()} disabled={retrying}>
              {retrying ? "Retrying…" : "Retry"}
            </button>
          )}
        </div>
      )}
    </li>
  );
}
