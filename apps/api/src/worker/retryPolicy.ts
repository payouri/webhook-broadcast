/**
 * ADR 0003's retry policy as pure, unit-testable functions: what counts as
 * retryable, how long to wait before the next Attempt, and how to read a
 * server's `Retry-After`. Kept free of I/O so `processDelivery.ts` can
 * exercise every branch without a clock or a network call.
 */

export interface OutcomeClassificationInput {
  /** `null` for a network error, TLS failure, or client-side timeout. */
  statusCode: number | null;
}

/**
 * Retry network/TLS/timeout (no status code), `408`, `429`, and `5xx`.
 * Every other status — including other `4xx` — fails the Delivery
 * immediately (ADR 0003).
 */
export function isRetryableOutcome(input: OutcomeClassificationInput): boolean {
  const { statusCode } = input;
  if (statusCode === null) {
    return true;
  }
  if (statusCode === 408 || statusCode === 429) {
    return true;
  }
  return statusCode >= 500 && statusCode < 600;
}

/**
 * Parses a `Retry-After` header value (delay-seconds or an HTTP-date) into
 * milliseconds from `now`. Returns `undefined` for a missing/unparsable
 * header so the caller falls back to the computed exponential backoff.
 */
export function parseRetryAfterMs(
  headerValue: string | null | undefined,
  now: Date,
): number | undefined {
  if (!headerValue) {
    return undefined;
  }
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const dateMs = Date.parse(headerValue);
  if (Number.isNaN(dateMs)) {
    return undefined;
  }
  return Math.max(0, dateMs - now.getTime());
}

export interface BackoffInput {
  /** The attempt number that just failed (1-indexed). */
  attemptNumber: number;
  /** Base delay for attempt 1, doubling each subsequent attempt. */
  baseMs: number;
  /** Upper bound applied to both the computed backoff and an honoured `Retry-After`. */
  capMs: number;
  /** An honoured `Retry-After`, already converted to milliseconds. */
  retryAfterMs?: number;
  /** Injectable for deterministic tests; defaults to `Math.random`. */
  random?: () => number;
}

/**
 * Exponential backoff with full jitter (uniformly random in `[0, capped]`),
 * capped at `capMs`. A `Retry-After` overrides the exponential computation
 * outright but is still capped (ADR 0003: "honoured up to the backoff cap").
 */
export function computeBackoffDelayMs(input: BackoffInput): number {
  if (input.retryAfterMs !== undefined) {
    return Math.min(input.retryAfterMs, input.capMs);
  }
  const random = input.random ?? Math.random;
  const exponential = input.baseMs * 2 ** (input.attemptNumber - 1);
  const capped = Math.min(exponential, input.capMs);
  return Math.round(random() * capped);
}
