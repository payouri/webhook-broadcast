import type { BroadcastEndpointDelivery } from "@webhook-broadcast/contract";

/**
 * Issue #98: the reason a grouped Broadcast row failed, without expanding it.
 * `BroadcastEndpointDelivery` (issue #84) inlines that one Endpoint's Delivery
 * facts on the list item exactly so this can read the cause off the row —
 * `503 after 4.2s` for a downstream Endpoint that answered with a bad status,
 * `timeout 15000ms` for a transport-level failure that never got one.
 *
 * `lastStatusCode` is the discriminator: present, the failure is "the
 * Endpoint answered, badly", so the sentence names the code and how long the
 * attempt took, in seconds — the unit an operator reads a request's latency
 * in. Absent, the failure never reached a response at all (a timeout, a
 * connection refusal, a TLS failure), so `lastError` is the only description
 * of what happened, and `lastDurationMs` renders in the millisecond unit the
 * error itself is usually phrased in (a configured timeout of `15000ms`).
 */
export function formatDeliveryCause(delivery: BroadcastEndpointDelivery): string {
  if (delivery.lastStatusCode != null) {
    const seconds =
      delivery.lastDurationMs != null ? `${(delivery.lastDurationMs / 1000).toFixed(1)}s` : "?s";
    return `${delivery.lastStatusCode} after ${seconds}`;
  }
  if (delivery.lastError) {
    return delivery.lastDurationMs != null
      ? `${delivery.lastError} ${delivery.lastDurationMs}ms`
      : delivery.lastError;
  }
  return delivery.status.replaceAll("_", " ");
}
