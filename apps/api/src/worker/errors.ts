/**
 * Thrown by `processDelivery` when the Attempt should be tried again: either a
 * retryable failure that hasn't exhausted `DELIVERY_MAX_ATTEMPTS` yet, or a
 * failure to persist the outcome at all — which is retryable on every path,
 * including the terminal `failed` and `dead_lettered` ones, because the
 * Delivery is left back on `pending` with the outcome unrecorded.
 * `worker.ts`'s BullMQ `backoffStrategy`
 * reads `delayMs` straight off it — the retry-policy math (ADR 0003) all
 * happens in `retryPolicy.ts`/`processDelivery.ts`, not in the BullMQ
 * wiring, so it stays testable without a live Redis.
 */
export class RetryableDeliveryError extends Error {
  constructor(
    message: string,
    readonly delayMs: number,
  ) {
    super(message);
    this.name = "RetryableDeliveryError";
  }
}
