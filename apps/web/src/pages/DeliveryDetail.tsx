import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Inbox, Repeat } from "lucide-react";
import type { Attempt, BroadcastDetail } from "@webhook-broadcast/contract";
import { EmptyState } from "../components/EmptyState.js";
import { DeliveryStatusLamp } from "../components/StatusLamp.js";
import { api, describeApiError } from "../lib/api.js";
import { useDelayedPending } from "../lib/delayedPending.js";
import { formatAbsolute, formatBackoffGap } from "../lib/relativeTime.js";

type DeliveryItem = BroadcastDetail["deliveries"][number];

/**
 * ADR 0003's default attempt budget (`DEFAULT_DELIVERY_MAX_ATTEMPTS` in
 * `packages/contract/src/env.ts`), duplicated here rather than imported: env
 * schemas are process-boot-only and deliberately not part of this package's
 * browser-shared entry point (see that file's `index.ts` comment), and there
 * is no admin-API endpoint that surfaces the runtime-configured value. An
 * operator running with a `DELIVERY_MAX_ATTEMPTS` override sees the wrong
 * denominator until such an endpoint exists.
 */
const ATTEMPT_BUDGET = 8;

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
 * Whether the worker has nothing further coming for this Delivery. `pending`
 * and `in_progress` are the only two non-terminal states — the reasoning is
 * spelled out on `BroadcastFanoutLamp`: a non-retryable outcome finishes a
 * Delivery as `failed` without retrying it, a retryable one that still has
 * budget is left `pending`, and `dead_lettered` has spent the budget.
 */
function isSettled(status: DeliveryItem["status"]): boolean {
  return status !== "pending" && status !== "in_progress";
}

/**
 * What a retry actually did, in the domain's own terms (issue #89).
 *
 * `POST /deliveries/{id}/retry` only re-queues: `retryDeadLetteredDelivery`
 * flips the row back to `pending` and the route then enqueues it, so the
 * response says nothing about how the re-delivery went — the worker has not
 * run yet. The verdict arrives later, on the ~5s Broadcast-detail poll, as a
 * new Attempt and a settled status. Reading an outcome out of the retry
 * response itself would announce a success that has not happened.
 *
 * ADR 0003 grants no fresh budget either: `attemptCount` is deliberately left
 * where it was (the `attempt_delivery_id_n_key` unique index forbids reusing
 * an `n`), so a Delivery dead-lettered on its last Attempt gets exactly one
 * more and re-dead-letters if it fails. That is the fact this message exists
 * to state, so it names the Attempt that was spent — `attemptCount` is the `n`
 * of the Attempt just written — phrased exactly as the timeline rows phrase
 * it, so the announcement and the row underneath it cannot disagree.
 */
function describeRetryOutcome(delivery: DeliveryItem): { message: string; ok: boolean } {
  const spent = `Retry spent Attempt ${delivery.attemptCount} of ${ATTEMPT_BUDGET}`;
  if (delivery.status === "succeeded") {
    return { message: `${spent}, succeeded`, ok: true };
  }
  const reason = delivery.lastError !== null ? `: ${delivery.lastError}` : "";
  // `failed` and `dead_lettered` are both terminal and differ in why, exactly
  // as the lamp beside them distinguishes them: one hit a non-retryable
  // outcome, the other came back to the end of its budget.
  const verdict = delivery.status === "dead_lettered" ? "re-dead-lettered" : "failed";
  return { message: `${spent}${reason}, ${verdict}`, ok: false };
}

interface AttemptRow {
  attempt: Attempt;
  /** `null` when this row's error is identical to what is already on screen. */
  errorToShow: string | null;
  /** Actual time since the previous Attempt; `null` for the first row. */
  gapMs: number | null;
}

/**
 * Builds the Attempt timeline's per-row view model in a single pass, pairing
 * each `Attempt` with the two things issue #75 asked to make legible:
 *
 * - The error text repeats a shared string once as the Delivery summary and
 *   once per Attempt row when every retry failed the same way. This states
 *   each distinct error only where it first differs from what is already on
 *   screen — the summary line above the list, then the previous Attempt — so
 *   a run of eight identical timeouts reads once, and a run that changes
 *   partway through still shows exactly where.
 * - The backoff gap since the previous Attempt, read back from the recorded
 *   timestamps rather than recomputed from the backoff formula, since a
 *   `Retry-After` override or jitter landing near zero both change what
 *   really happened.
 *
 * `summaryError` must be the error the summary line is *actually rendering*,
 * not `delivery.lastError` unconditionally — suppressing a row against text
 * that is not on screen would hide the failure reason entirely.
 */
function buildAttemptRows(attempts: Attempt[], summaryError: string | null): AttemptRow[] {
  const rows: AttemptRow[] = [];
  let previousError = summaryError;
  let previousAt: string | null = null;
  for (const attempt of attempts) {
    const errorToShow =
      attempt.error !== null && attempt.error !== previousError ? attempt.error : null;
    const gapMs =
      previousAt !== null ? new Date(attempt.at).getTime() - new Date(previousAt).getTime() : null;
    rows.push({ attempt, errorToShow, gapMs });
    previousError = attempt.error;
    previousAt = attempt.at;
  }
  return rows;
}

/**
 * Delivery detail (issue #21): Endpoint identity + status are already on the
 * `delivery` row from the Broadcast detail response; expanding fetches the
 * Attempt timeline, and a Retry action appears only once `dead_lettered`
 * (ADR 0003 — distinct from Broadcast Replay).
 *
 * The Attempt timeline (issue #75) states each row's number against
 * `ATTEMPT_BUDGET`, the actual gap since the previous Attempt
 * (`buildAttemptRows`), and an absolute timestamp rather than elapsed time —
 * see DESIGN.md for why this surface reverses the elapsed-time default.
 */
export function DeliveryDetail({
  delivery,
  onRetried,
  onActivityChanged,
}: {
  delivery: DeliveryItem;
  onRetried: () => void;
  onActivityChanged?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [attempts, setAttempts] = useState<Attempt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const retryingLabel = useDelayedPending(retrying);
  // The Attempt list's own delay-and-hold (DESIGN.md §5): see
  // ChannelActivityTab. `attempts` resets to `null` on every expand, so this
  // recomputes cleanly each time the well opens. Gated on `expanded` because a
  // collapsed row is not waiting for anything — its Attempts are `null` only
  // because nobody has asked for them, and letting the delay run against that
  // ambient `null` would arm the loading line before the first click, so an
  // expand that resolves in 20ms would paint it and drop it on the next frame:
  // exactly the flash this rule exists to remove.
  const showAttemptsLoading = useDelayedPending(expanded && attempts === null && !error);
  const [retryOutcome, setRetryOutcome] = useState<{
    message: string;
    ok: boolean;
  } | null>(null);
  // Set the moment a retry is accepted, holding the Attempt count as it stood
  // then; cleared when the poll brings back a verdict to announce.
  const [awaitingVerdict, setAwaitingVerdict] = useState<{ attemptCountAtRetry: number } | null>(
    null,
  );
  const reportRef = useRef<HTMLParagraphElement>(null);
  const focusReportOnRender = useRef(false);

  async function loadAttempts(): Promise<void> {
    try {
      const list = await api.listDeliveryAttempts(delivery.id);
      setAttempts(list.items);
      setError(null);
    } catch (err) {
      setError(describeApiError(err, "Failed to load Attempts"));
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

  // The poll is the only witness to how a retry went, so the verdict is read
  // off the `delivery` prop the Broadcast-detail poll keeps refreshing, not off
  // the retry response (see `describeRetryOutcome`). Both halves of the
  // evidence are required before anything is announced:
  //
  //  - a *new* Attempt, i.e. `attemptCount` past where it stood at the press.
  //    The row still reads `dead_lettered` for as long as it takes the refetch
  //    to land, and announcing on status alone would re-announce the failure
  //    the operator just pressed Retry on, as though the retry had produced it.
  //  - a settled status. A retryable Attempt with budget left leaves the
  //    Delivery `pending` again while it waits out its backoff, which is not a
  //    verdict — the announcement waits for the one that is.
  useEffect(() => {
    if (awaitingVerdict === null) {
      return;
    }
    if (delivery.attemptCount <= awaitingVerdict.attemptCountAtRetry) {
      return;
    }
    if (!isSettled(delivery.status)) {
      return;
    }
    setAwaitingVerdict(null);
    setRetryOutcome(describeRetryOutcome(delivery));
    // The new Attempt belongs on the timeline the announcement is naming.
    // `loadAttempts` is intentionally not a dependency: it is re-created on
    // every render and the only thing it closes over is `delivery.id`, which is
    // fixed for the life of this row.
    void loadAttempts();
  }, [awaitingVerdict, delivery]);

  useEffect(() => {
    if (focusReportOnRender.current && (awaitingVerdict !== null || retryOutcome !== null)) {
      focusReportOnRender.current = false;
      reportRef.current?.focus();
    }
  }, [awaitingVerdict, retryOutcome]);

  async function handleRetry(): Promise<void> {
    setRetrying(true);
    setError(null);
    setRetryOutcome(null);
    try {
      await api.retryDelivery(delivery.id);
      // Nothing has been re-delivered yet: the route re-queued the Delivery and
      // returned. Record where the Attempt count stood so the poll can tell the
      // Attempt this retry spends from the ones already on the timeline.
      setAwaitingVerdict({ attemptCountAtRetry: delivery.attemptCount });
      // Not back to the Retry button: `onRetried` moves this Delivery out of
      // `dead_lettered`, which takes that button off screen, and focus would
      // drop onto the body with nothing ringed. The report is what replaces the
      // control in place and what the operator now needs to read — the same
      // contract as the bulk retry's report in `BroadcastDetailPanel`.
      focusReportOnRender.current = true;
      await loadAttempts();
      onRetried();
      onActivityChanged?.();
    } catch (err) {
      setError(describeApiError(err, "Failed to retry Delivery"));
    } finally {
      setRetrying(false);
    }
  }

  // Single source of truth for "is the Delivery's own last error on screen
  // above the Attempt list": a fetch or retry failure takes that slot instead,
  // and the Attempt rows must then state their error rather than suppress it
  // against a line nobody can see.
  const summaryError = error === null ? delivery.lastError : null;

  return (
    <li
      onKeyDown={(event) => {
        // Same contract as the Broadcast row: Escape collapses from anywhere
        // in the well (the Attempt list, the Retry button) and returns focus
        // to the row that opened it.
        if (event.key === "Escape" && expanded) {
          event.stopPropagation();
          const rowButton = event.currentTarget.querySelector<HTMLButtonElement>(".row-delivery");
          setExpanded(false);
          rowButton?.focus();
        }
      }}
    >
      <button
        type="button"
        className="row row-delivery"
        data-row-nav="true"
        aria-expanded={expanded}
        onClick={toggle}
      >
        <DeliveryStatusLamp status={delivery.status} />
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

          {showAttemptsLoading && <p className="muted">Loading Attempts…</p>}
          {!showAttemptsLoading && error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          {summaryError && <p className="error-text delivery-error">{summaryError}</p>}

          {!showAttemptsLoading && attempts !== null && attempts.length === 0 && (
            <EmptyState icon={<Inbox size={20} strokeWidth={1.5} />}>No Attempts yet.</EmptyState>
          )}
          {!showAttemptsLoading && attempts !== null && attempts.length > 0 && (
            <ul className="row-list row-list-tight">
              {buildAttemptRows(attempts, summaryError).map(({ attempt, errorToShow, gapMs }) => {
                return (
                  <li key={attempt.id} className="row-attempt">
                    <span className="attempt-n">
                      Attempt {attempt.n} of {ATTEMPT_BUDGET}
                    </span>
                    {gapMs !== null && (
                      <span className="muted attempt-gap">waited {formatBackoffGap(gapMs)}</span>
                    )}
                    <time dateTime={attempt.at} className="muted attempt-time">
                      {formatAbsolute(attempt.at)}
                    </time>
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
                    {errorToShow && <span className="error-text">{errorToShow}</span>}
                  </li>
                );
              })}
            </ul>
          )}

          {/* Issue #89: a retry that re-dead-letters used to say nothing at
              all — the row simply reverted and the Retry button came back, as
              though nothing had been spent. The report takes the control's
              place from the moment the retry is accepted and stays there: it
              states that the retry is queued, then what it cost.

              It is not itself routed through the delay-and-hold hook. DESIGN.md
              §5 binds that treatment to representations of *waiting*, which is
              what the button's own `Retrying…` label is and where the hook is
              already applied; the No-Flicker Rule then governs what replaces a
              held pending state, and this is that replacement. A verdict the
              operator has earned is not withdrawn 400ms later. */}
          {(awaitingVerdict !== null || retryOutcome !== null) && (
            <p
              ref={reportRef}
              className={
                retryOutcome === null ? "muted" : retryOutcome.ok ? "success-text" : "error-text"
              }
              role="status"
              tabIndex={-1}
            >
              {retryOutcome?.message ?? "Retry queued, waiting for the Attempt to be spent"}
            </p>
          )}

          {delivery.status === "dead_lettered" && awaitingVerdict === null && (
            <div className="inline-form">
              <button
                type="button"
                className="control control-primary"
                onClick={() => void handleRetry()}
                disabled={retrying}
              >
                <Repeat size={13} strokeWidth={1.75} aria-hidden="true" />
                {retryingLabel ? "Retrying…" : "Retry"}
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
