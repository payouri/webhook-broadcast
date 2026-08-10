import {
  completeDelivery,
  getDeliveryForProcessing,
  markDeliveryInProgress,
  maybeAutoDisableEndpoint,
  resetInProgressDeliveryToPending,
  type Database,
} from "@webhook-broadcast/db";
import {
  DEFAULT_DELIVERY_BACKOFF_MAX_MS,
  DEFAULT_DELIVERY_BACKOFF_MS,
  DEFAULT_DELIVERY_MAX_ATTEMPTS,
  DEFAULT_ENDPOINT_AUTO_DISABLE_AFTER_MS,
} from "@webhook-broadcast/contract/env";
import { RetryableDeliveryError } from "./errors.js";
import { computeBackoffDelayMs, isRetryableOutcome, parseRetryAfterMs } from "./retryPolicy.js";
import type { DeliveryJobData } from "../deliveryQueue.js";
import type { MetricsCollector, AttemptResultClass } from "../observability/metrics.js";
import { logStructured } from "../observability/logger.js";

export interface ProcessDeliveryDeps {
  db: Database;
  /** Falls back to the Endpoint's own `timeoutMs` when set (ADR 0007/0008). */
  defaultTimeoutMs: number;
  fetchImpl?: typeof fetch;
  /** ADR 0003 retry policy knobs — default to that ADR's documented defaults. */
  maxAttempts?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  /** ADR 0003 auto-disable window — default matches env.ts. */
  endpointAutoDisableAfterMs?: number;
  /** Injectable for deterministic tests. */
  random?: () => number;
  now?: () => Date;
  metrics?: MetricsCollector;
}

/**
 * One Delivery's HTTP Attempt, retried per ADR 0003's policy. Exported
 * standalone from the BullMQ `Worker` wiring so it can be exercised
 * directly against a stub HTTP target without a live Redis: a retryable
 * failure resolves normally after resetting the Delivery to `pending` for
 * the next Attempt (a caller simulating BullMQ's backoff just calls this
 * again), or throws `RetryableDeliveryError` — the shape `worker.ts`'s
 * BullMQ `backoffStrategy` needs to actually delay that next call in
 * production.
 */
export async function processDeliveryJob(
  deps: ProcessDeliveryDeps,
  deliveryId: string,
  observability?: Pick<DeliveryJobData, "requestId" | "channelId" | "broadcastId" | "endpointId">,
): Promise<void> {
  const maxAttempts = deps.maxAttempts ?? DEFAULT_DELIVERY_MAX_ATTEMPTS;
  const backoffBaseMs = deps.backoffBaseMs ?? DEFAULT_DELIVERY_BACKOFF_MS;
  const backoffMaxMs = deps.backoffMaxMs ?? DEFAULT_DELIVERY_BACKOFF_MAX_MS;
  const endpointAutoDisableAfterMs =
    deps.endpointAutoDisableAfterMs ?? DEFAULT_ENDPOINT_AUTO_DISABLE_AFTER_MS;
  const now = deps.now ?? (() => new Date());

  const record = await getDeliveryForProcessing(deps.db, deliveryId);
  if (!record) {
    // Delivery vanished (e.g. Broadcast retention swept it); nothing to do.
    return;
  }
  if (record.status !== "pending" && record.status !== "in_progress") {
    // Idempotency guard against a redelivered/duplicate job on a terminal
    // Delivery. `in_progress` is admitted so a stale BullMQ redelivery can
    // resume after a worker crash; retryable outcomes reset to `pending` below.
    return;
  }

  const inProgress = await markDeliveryInProgress(deps.db, deliveryId, now());
  if (!inProgress) {
    return;
  }

  logStructured({
    msg: "delivery attempt started",
    deliveryId,
    ...(observability?.requestId ? { requestId: observability.requestId } : {}),
    ...(observability?.channelId ? { channelId: observability.channelId } : {}),
    ...(observability?.broadcastId ? { broadcastId: observability.broadcastId } : {}),
    ...(observability?.endpointId ? { endpointId: observability.endpointId } : {}),
  });

  const timeoutMs = record.endpoint.timeoutMs ?? deps.defaultTimeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let statusCode: number | null = null;
  let error: string | null = null;
  let retryAfterMs: number | undefined;
  const startedAt = process.hrtime.bigint();
  try {
    const doFetch = deps.fetchImpl ?? fetch;
    const response = await doFetch(record.endpoint.url, {
      method: "POST",
      headers: {
        ...record.endpoint.headers,
        "content-type": record.broadcast.contentType,
      },
      body: record.broadcast.body,
      signal: controller.signal,
      redirect: "manual",
    });
    statusCode = response.status;
    if (statusCode === 429 || statusCode === 503) {
      retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"), now());
    }
    // Drain the response body so the connection can be released back to
    // the pool; we never persist it (CONTEXT.md: Attempt stores status
    // code/duration/error, "not the response body").
    await response.arrayBuffer().catch(() => undefined);
  } catch (err) {
    error = controller.signal.aborted
      ? `timed out after ${timeoutMs}ms`
      : err instanceof Error
        ? err.message
        : String(err);
  } finally {
    clearTimeout(timer);
  }

  const durationMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
  const n = record.attemptCount + 1;
  const at = now();

  const finishAttempt = async (
    status: "succeeded" | "failed" | "dead_lettered" | "pending",
    resultClass: AttemptResultClass,
  ): Promise<void> => {
    deps.metrics?.recordAttempt(resultClass, durationMs);
    logStructured({
      msg: "delivery attempt finished",
      deliveryId,
      result: resultClass,
      durationMs,
      statusCode,
      ...(observability?.requestId ? { requestId: observability.requestId } : {}),
      ...(observability?.channelId ? { channelId: observability.channelId } : {}),
      ...(observability?.broadcastId ? { broadcastId: observability.broadcastId } : {}),
      ...(observability?.endpointId ? { endpointId: observability.endpointId } : {}),
    });
    try {
      await completeDelivery(deps.db, {
        deliveryId,
        n,
        statusCode,
        durationMs,
        error: status === "succeeded" ? null : error,
        status,
        at,
      });
    } catch (dbErr) {
      await resetInProgressDeliveryToPending(deps.db, deliveryId, at);
      const message = dbErr instanceof Error ? dbErr.message : String(dbErr);
      const delayMs = computeBackoffDelayMs({
        attemptNumber: n,
        baseMs: backoffBaseMs,
        capMs: backoffMaxMs,
        ...(deps.random ? { random: deps.random } : {}),
      });
      throw new RetryableDeliveryError(
        `Delivery ${deliveryId} Attempt ${n} could not persist outcome (${message}); retrying in ${delayMs}ms`,
        delayMs,
      );
    }
  };

  if (statusCode !== null && statusCode >= 200 && statusCode < 300) {
    await finishAttempt("succeeded", "succeeded");
    return;
  }

  if (!isRetryableOutcome({ statusCode })) {
    await finishAttempt("failed", "failed");
    await maybeAutoDisableEndpoint(deps.db, {
      endpointId: record.endpointId,
      autoDisableAfterMs: endpointAutoDisableAfterMs,
      now: at,
    });
    return;
  }

  if (n >= maxAttempts) {
    await finishAttempt("dead_lettered", "dead_lettered");
    await maybeAutoDisableEndpoint(deps.db, {
      endpointId: record.endpointId,
      autoDisableAfterMs: endpointAutoDisableAfterMs,
      now: at,
    });
    return;
  }

  await finishAttempt("pending", "retry");
  const delayMs = computeBackoffDelayMs({
    attemptNumber: n,
    baseMs: backoffBaseMs,
    capMs: backoffMaxMs,
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    ...(deps.random ? { random: deps.random } : {}),
  });
  throw new RetryableDeliveryError(
    `Delivery ${deliveryId} Attempt ${n} failed (${statusCode ?? error}); retrying in ${delayMs}ms`,
    delayMs,
  );
}
