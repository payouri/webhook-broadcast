import { useState } from "react";
import { ChevronDown, ChevronRight, Inbox, Repeat } from "lucide-react";
import type { Attempt, BroadcastDetail } from "@webhook-broadcast/contract";
import { EmptyState } from "../components/EmptyState.js";
import { DeliveryStatusBadge } from "../components/StatusBadge.js";
import { api, describeApiError } from "../lib/api.js";
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

  async function handleRetry(): Promise<void> {
    setRetrying(true);
    setError(null);
    try {
      await api.retryDelivery(delivery.id);
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
          {summaryError && <p className="error-text delivery-error">{summaryError}</p>}

          {attempts === null && !error && (
            <p className="muted loading-delayed">Loading Attempts…</p>
          )}
          {attempts !== null && attempts.length === 0 && (
            <EmptyState icon={<Inbox size={20} strokeWidth={1.5} />}>No Attempts yet.</EmptyState>
          )}
          {attempts !== null && attempts.length > 0 && (
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
