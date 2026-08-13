import { useState } from "react";
import { ChevronDown, ChevronRight, Inbox, Repeat } from "lucide-react";
import type { Attempt, BroadcastDetail } from "@webhook-broadcast/contract";
import { EmptyState } from "../components/EmptyState.js";
import { DeliveryStatusBadge } from "../components/StatusBadge.js";
import { api } from "../lib/api.js";

type DeliveryItem = BroadcastDetail["deliveries"][number];

/**
 * A missing HTTP status code stays a dash on screen (the tabular convention) but
 * announces its meaning instead of the character. `role="img"` is what carries
 * that: `aria-label` is prohibited on a bare `span`, whose implicit `generic`
 * role exposes no accessible name, so the label alone would be dropped.
 */
function MissingStatusCode() {
  return (
    <span role="img" aria-label="No status code recorded">
      —
    </span>
  );
}

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
    <li>
      <button type="button" className="row row-delivery" aria-expanded={expanded} onClick={toggle}>
        <DeliveryStatusBadge status={delivery.status} />
        <span className="delivery-endpoint">{delivery.endpointName ?? delivery.endpointUrl}</span>
        <span className="muted delivery-meta">
          {delivery.lastStatusCode !== null ? (
            `HTTP ${delivery.lastStatusCode}`
          ) : (
            <MissingStatusCode />
          )}
          {delivery.lastDurationMs !== null ? ` · ${delivery.lastDurationMs}ms` : ""}
          {expanded ? (
            <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" />
          )}
        </span>
      </button>

      {expanded && (
        <div className="well well-delivery">
          <p className="muted delivery-endpoint-url">{delivery.endpointUrl}</p>

          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          {delivery.lastError && !error && (
            <p className="error-text delivery-error">{delivery.lastError}</p>
          )}

          {attempts === null && !error && (
            <p className="muted loading-delayed">Loading Attempts…</p>
          )}
          {attempts !== null && attempts.length === 0 && (
            <EmptyState icon={<Inbox size={20} strokeWidth={1.5} />}>No Attempts yet.</EmptyState>
          )}
          {attempts !== null && attempts.length > 0 && (
            <ul className="row-list row-list-tight">
              {attempts.map((attempt) => (
                <li key={attempt.id} className="row-attempt">
                  <span className="attempt-n">#{attempt.n}</span>
                  <span className="muted">{new Date(attempt.at).toLocaleString()}</span>
                  <span>
                    {attempt.statusCode !== null ? (
                      `HTTP ${attempt.statusCode}`
                    ) : (
                      <MissingStatusCode />
                    )}
                  </span>
                  <span className="muted">
                    {attempt.durationMs !== null ? `${attempt.durationMs}ms` : ""}
                  </span>
                  {attempt.error && <span className="error-text">{attempt.error}</span>}
                </li>
              ))}
            </ul>
          )}

          {delivery.status === "dead_lettered" && (
            <div className="inline-form">
              <button
                type="button"
                className="control control-primary"
                onClick={() => void handleRetry()}
                disabled={retrying}
              >
                <Repeat size={13} strokeWidth={1.75} aria-hidden="true" />
                {retrying ? "Retrying…" : "Retry"}
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
