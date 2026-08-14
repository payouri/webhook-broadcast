import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Inbox, Repeat, RotateCcw, X } from "lucide-react";
import type { BroadcastDetail } from "@webhook-broadcast/contract";
import { EmptyState } from "../../components/EmptyState.js";
import { InlineLoadError } from "../../components/InlineLoadError.js";
import { PollStatusLine } from "../../components/PollStatusLine.js";
import { SkeletonRows } from "../../components/SkeletonRows.js";
import { api, describeApiError } from "../../lib/api.js";
import {
  freshnessRefetchInterval,
  queryErrorMessage,
  useRefetchOnVisible,
} from "../../lib/freshness.js";
import { handleRowListKeyDown } from "../../lib/rowListKeyboard.js";
import { DeliveryDetail } from "../DeliveryDetail.js";

type DeliveryItem = BroadcastDetail["deliveries"][number];

interface BulkRetryOutcome {
  deliveryId: string;
  label: string;
  ok: boolean;
  error?: string;
}

/**
 * Bulk retry (issue #53): re-queues every `dead_lettered` Delivery in this
 * Broadcast in one action, over the same per-Delivery `POST
 * /deliveries/{id}/retry` route the row-level Retry button already uses (no
 * batch endpoint exists — ADR 0003 only ever speaks of retrying one Delivery).
 * Each call is independent and awaited with `allSettled`, never a single
 * combined promise: a downstream Endpoint that is still down for one Delivery
 * must not roll back the others that queued cleanly, and the operator needs
 * to know which Delivery is which either way.
 */
function BulkRetryDeadLettered({
  deadLettered,
  onSettled,
}: {
  deadLettered: readonly DeliveryItem[];
  onSettled: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [outcomes, setOutcomes] = useState<BulkRetryOutcome[] | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const reportRef = useRef<HTMLDivElement>(null);
  const restoreFocusOnClose = useRef(false);
  const focusReportOnRender = useRef(false);

  // Same overlay-free focus contract as the Danger Zone's delete confirm: the
  // confirm region replaces the trigger button in place, so focus is moved
  // onto it deliberately on open, and back to the trigger on cancel.
  useEffect(() => {
    if (confirming) {
      confirmRef.current?.focus();
      return;
    }
    if (restoreFocusOnClose.current) {
      restoreFocusOnClose.current = false;
      triggerRef.current?.focus();
    }
  }, [confirming]);

  useEffect(() => {
    if (outcomes !== null && focusReportOnRender.current) {
      focusReportOnRender.current = false;
      reportRef.current?.focus();
    }
  }, [outcomes]);

  function cancel(): void {
    restoreFocusOnClose.current = true;
    setConfirming(false);
  }

  async function handleConfirm(): Promise<void> {
    setRetrying(true);
    const targets = deadLettered;
    const results = await Promise.allSettled(
      targets.map((delivery) => api.retryDelivery(delivery.id)),
    );
    setOutcomes(
      targets.map((delivery, index) => {
        const label = delivery.endpointName ?? delivery.endpointUrl;
        const result = results[index];
        if (result?.status === "rejected") {
          return {
            deliveryId: delivery.id,
            label,
            ok: false,
            error: describeApiError(result.reason, "Failed to retry Delivery"),
          };
        }
        return { deliveryId: delivery.id, label, ok: true };
      }),
    );
    setRetrying(false);
    setConfirming(false);
    // Not back to the trigger: a retry that queues every dead-lettered Delivery
    // takes that trigger off screen the moment the refetch below lands, which
    // would drop focus onto the body with nothing ringed. The report is the
    // thing that survives and the thing the operator now needs to read, so
    // focus lands there instead, once it has rendered.
    focusReportOnRender.current = true;
    onSettled();
  }

  const count = deadLettered.length;
  const noun = count === 1 ? "Delivery" : "Deliveries";

  // Nothing left to say once every dead-lettered Delivery has been retried and
  // there is no earlier outcome still worth showing — rather than unmounting
  // whenever `count` drops, which a successful bulk retry would do to itself
  // the instant the refetch it triggered lands, wiping the very report it just
  // produced.
  if (count === 0 && outcomes === null) {
    return null;
  }

  return (
    <div className="broadcast-bulk-retry">
      {count > 0 &&
        (confirming ? (
          <div
            className="confirm-region"
            role="group"
            aria-label={`Confirm retry ${count} dead-lettered ${noun}`}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                cancel();
              }
            }}
          >
            <p>
              Retry <strong>{count}</strong> dead-lettered {noun}?
            </p>
            <div className="inline-form">
              <button
                ref={confirmRef}
                type="button"
                className="control control-commit"
                onClick={() => void handleConfirm()}
                disabled={retrying}
              >
                <Repeat size={13} strokeWidth={1.75} aria-hidden="true" />
                {retrying ? "Retrying…" : "Confirm retry"}
              </button>
              <button type="button" className="control" onClick={cancel} disabled={retrying}>
                <X size={13} strokeWidth={2} aria-hidden="true" />
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="inline-form">
            <button
              ref={triggerRef}
              type="button"
              className="control"
              onClick={() => setConfirming(true)}
            >
              <Repeat size={13} strokeWidth={1.75} aria-hidden="true" />
              {`Retry ${count} dead-lettered`}
            </button>
          </div>
        ))}

      {/* Per-Delivery outcome (issue #53): a partial failure leaves the
          Deliveries that did queue retried, and names the ones that did not —
          never a single pass/fail verdict for the whole batch. Stays on
          screen even once its own retries bring `count` to zero. */}
      {outcomes && (
        <div
          ref={reportRef}
          className="bulk-retry-report"
          role="status"
          aria-label="Bulk retry outcome"
          tabIndex={-1}
        >
          <ul className="bulk-retry-outcomes">
            {outcomes.map((outcome) => (
              <li key={outcome.deliveryId} className={outcome.ok ? "success-text" : "error-text"}>
                {outcome.label}: {outcome.ok ? "queued for retry" : outcome.error}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Broadcast detail (issue #19): inbound payload plus every fanned-out Delivery. */
export function BroadcastDetailPanel({
  channelId,
  broadcastId,
  onActivityChanged,
}: {
  channelId: string;
  broadcastId: string;
  /**
   * Something this panel did changed what the Activity list shows — a Replay
   * added a Broadcast, a bulk retry moved Deliveries out of `dead_lettered`.
   * Named for that, not for Replay alone, because both actions call it.
   */
  onActivityChanged?: () => void;
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
  const deadLetteredDeliveries = detail
    ? detail.deliveries.filter((delivery) => delivery.status === "dead_lettered")
    : [];

  async function handleReplay(): Promise<void> {
    setReplaying(true);
    setReplayError(null);
    try {
      const { id } = await api.replayBroadcast(channelId, broadcastId);
      setReplayedId(id);
      onActivityChanged?.();
    } catch (err) {
      setReplayError(describeApiError(err, "Failed to replay Broadcast"));
    } finally {
      setReplaying(false);
    }
  }

  return (
    <div className="well well-broadcast">
      <PollStatusLine
        dataUpdatedAt={broadcastQuery.dataUpdatedAt}
        isError={broadcastQuery.isError}
      />
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
            <>
              {/* Mounted unconditionally (not gated on `deadLetteredDeliveries.length`)
                  so a fully successful bulk retry does not unmount its own
                  outcome report the instant the refetch it triggers brings that
                  count to zero — see the component's own guard for the case
                  where there is truly nothing to show. */}
              <BulkRetryDeadLettered
                deadLettered={deadLetteredDeliveries}
                onSettled={() => {
                  void broadcastQuery.refetch();
                  onActivityChanged?.();
                }}
              />
              <ul className="row-list row-list-tight" onKeyDown={handleRowListKeyDown}>
                {detail.deliveries.map((delivery) => (
                  <DeliveryDetail
                    key={delivery.id}
                    delivery={delivery}
                    onRetried={() => void broadcastQuery.refetch()}
                  />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
