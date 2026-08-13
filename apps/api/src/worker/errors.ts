/**
 * Thrown by `processDelivery` for a retryable failure that hasn't
 * exhausted `DELIVERY_MAX_ATTEMPTS` yet. `worker.ts`'s BullMQ `backoffStrategy`
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
