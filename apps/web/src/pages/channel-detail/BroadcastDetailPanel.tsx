import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Inbox, Repeat, RotateCcw, X } from "lucide-react";
import type { BroadcastDetail } from "@webhook-broadcast/contract";
import { EmptyState } from "../../components/EmptyState.js";
import { InlineLoadError } from "../../components/InlineLoadError.js";
import { PollStatusLine } from "../../components/PollStatusLine.js";
import { SkeletonRows } from "../../components/SkeletonRows.js";
import { api, describeApiError } from "../../lib/api.js";
import { useDelayedPending } from "../../lib/delayedPending.js";
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
  const retryingLabel = useDelayedPending(retrying);
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
                {retryingLabel ? "Retrying…" : "Confirm retry"}
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

/**
 * Replay confirmation (issue #76): Replay accepts a brand-new Broadcast whose
 * fan-out snapshots the Endpoints enabled at replay time, so it can deliver a
 * production payload to Endpoints that were not part of the original fan-out.
 * That earns the same confirm-region idiom the bulk retry and the Danger Zone
 * delete already use, and the question is posed in counted terms so the
 * operator commits against a number rather than a guess.
 */
function ReplayBroadcast({
  channelId,
  onReplay,
}: {
  channelId: string;
  onReplay: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const replayingLabel = useDelayedPending(replaying);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [replayed, setReplayed] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocusOnClose = useRef(false);

  // Shares the Endpoints tab's query key, so an operator who has already
  // loaded that tab opens this confirmation against warm data.
  const endpointsQuery = useQuery({
    queryKey: ["endpoints", channelId] as const,
    queryFn: () => api.listEndpoints(channelId),
  });
  const refetchEndpoints = endpointsQuery.refetch;

  useEffect(() => {
    if (confirming) {
      // The count has to describe the Endpoints enabled *now*, not the ones
      // enabled whenever this panel first mounted — an Endpoint toggled in the
      // Endpoints tab in between would otherwise leave the question stating a
      // fan-out width the replay will not use.
      void refetchEndpoints();
      confirmRef.current?.focus();
      return;
    }
    if (restoreFocusOnClose.current) {
      restoreFocusOnClose.current = false;
      triggerRef.current?.focus();
    }
  }, [confirming, refetchEndpoints]);

  function cancel(): void {
    restoreFocusOnClose.current = true;
    setConfirming(false);
    setReplayError(null);
  }

  async function handleConfirm(): Promise<void> {
    setReplaying(true);
    setReplayError(null);
    try {
      await onReplay();
      setReplayed(true);
      // The confirm button unmounts with the region, so focus is handed back to
      // the trigger deliberately rather than dropped onto the body — the same
      // overlay-free focus contract the bulk retry above documents.
      restoreFocusOnClose.current = true;
      setConfirming(false);
    } catch (err) {
      setReplayError(describeApiError(err, "Failed to replay Broadcast"));
    } finally {
      setReplaying(false);
    }
  }

  // Null while the Endpoints have not loaded or the load failed. The question is
  // then posed without a count rather than with a wrong one: `?? 0` would assert
  // "0 enabled Endpoints" — a fan-out width that is both false and reassuring —
  // at exactly the moment the operator is deciding whether to send real traffic.
  // Same rule as the Channel disable advisory, which suppresses its count rather
  // than state one it does not have.
  const enabledCount = endpointsQuery.data
    ? endpointsQuery.data.items.filter((endpoint) => endpoint.enabled).length
    : null;

  return (
    <div className="broadcast-replay">
      {confirming ? (
        <div
          className="confirm-region"
          role="group"
          aria-label="Confirm replay Broadcast"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              cancel();
            }
          }}
        >
          <p>
            {enabledCount === null ? (
              "Replay this Broadcast?"
            ) : (
              <>
                Replay to <strong>{enabledCount}</strong> enabled Endpoint
                {enabledCount === 1 ? "" : "s"}?
              </>
            )}{" "}
            The fan-out uses the Endpoints enabled now, which may differ from the ones the original
            was fanned out to.
          </p>
          {replayError && (
            <p className="error-text" role="alert">
              {replayError}
            </p>
          )}
          <div className="inline-form">
            <button
              ref={confirmRef}
              type="button"
              className="control control-commit"
              onClick={() => void handleConfirm()}
              disabled={replaying}
            >
              <RotateCcw size={13} strokeWidth={1.75} aria-hidden="true" />
              {replayingLabel ? "Replaying…" : "Confirm replay"}
            </button>
            <button type="button" className="control" onClick={cancel} disabled={replaying}>
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
            onClick={() => {
              setReplayed(false);
              setConfirming(true);
            }}
          >
            <RotateCcw size={13} strokeWidth={1.75} aria-hidden="true" />
            Replay
          </button>
          {/* The confirm region collapses back to this trigger on success, which
              on its own leaves nothing to say the replay landed. Announced,
              because focus has just been moved to the trigger beside it. */}
          {replayed && (
            <span className="success-text" role="status">
              Replayed. See it in Activity.
            </span>
          )}
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
    await api.replayBroadcast(channelId, broadcastId);
    onActivityChanged?.();
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

          {/* Replay (issue #76): confirm before re-fanning the stored payload out
              to Endpoints enabled right now; no new ingest needed. The fan-out
              snapshots the enabled Endpoints at replay time, which may differ
              from the original accept. */}
          <ReplayBroadcast channelId={channelId} onReplay={handleReplay} />

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
                    {...(onActivityChanged ? { onActivityChanged } : {})}
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
