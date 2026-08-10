import {
  completeDelivery,
  getDeliveryForProcessing,
  markDeliveryInProgress,
  type Database,
} from "@webhook-broadcast/db";

export interface ProcessDeliveryDeps {
  db: Database;
  /** Falls back to the Endpoint's own `timeoutMs` when set (ADR 0007/0008). */
  defaultTimeoutMs: number;
  fetchImpl?: typeof fetch;
}

/**
 * One Delivery's single HTTP Attempt (issue #19 — first Attempt only; full
 * retry policy per ADR 0003 is a later ticket). `2xx` succeeds; every other
 * outcome — non-2xx, network error, or timeout — fails the Delivery.
 *
 * Exported standalone from the BullMQ `Worker` wiring so it can be
 * exercised directly against a stub HTTP target without a live Redis.
 */
export async function processDeliveryJob(
  deps: ProcessDeliveryDeps,
  deliveryId: string,
): Promise<void> {
  const record = await getDeliveryForProcessing(deps.db, deliveryId);
  if (!record) {
    // Delivery vanished (e.g. Broadcast retention swept it); nothing to do.
    return;
  }
  if (record.status !== "pending") {
    // Idempotency guard against a redelivered/duplicate job.
    return;
  }

  const inProgress = await markDeliveryInProgress(deps.db, deliveryId, new Date());
  if (!inProgress) {
    return;
  }

  const timeoutMs = record.endpoint.timeoutMs ?? deps.defaultTimeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let statusCode: number | null = null;
  let error: string | null = null;
  const startedAt = process.hrtime.bigint();
  try {
    const doFetch = deps.fetchImpl ?? fetch;
    const response = await doFetch(record.endpoint.url, {
      method: "POST",
      headers: {
        "content-type": record.broadcast.contentType,
        ...record.endpoint.headers,
      },
      body: record.broadcast.body,
      signal: controller.signal,
    });
    statusCode = response.status;
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
  const succeeded = statusCode !== null && statusCode >= 200 && statusCode < 300;

  await completeDelivery(deps.db, {
    deliveryId,
    n: record.attemptCount + 1,
    statusCode,
    durationMs,
    error,
    status: succeeded ? "succeeded" : "failed",
    at: new Date(),
  });
}
