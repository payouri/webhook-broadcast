import { createHash } from "node:crypto";
import {
  FORWARDED_HEADER_FINGERPRINT_LENGTH,
  type ForwardedHeaderFingerprint,
} from "@webhook-broadcast/contract";
import { normalizeForwardAllowlist, selectForwardableHeaders } from "../worker/forwardHeaders.js";

/**
 * Issue #112: identify a Broadcast's stored forwarded headers to an operator
 * without handing the admin API their values.
 *
 * The motivating failure is a shared secret derived from an API key and baked
 * into a long-lived producer-side registration: rotate the key and every
 * Delivery 401s at the Endpoint while ingest keeps answering 200, so the only
 * way to tell a stale producer-side secret from a misconfigured Endpoint is to
 * compare what the producer actually presented against what the current key
 * derives. The stored Broadcast is the only place the first value exists.
 *
 * A truncated SHA-256 answers that comparison exactly as well as the values
 * would, and discloses nothing usable — which matters because the admin API's
 * audience (an operator dashboard, an operator key, anyone holding either) is
 * far broader than the Endpoint the header was minted for.
 *
 * Selection reuses the delivery path's own `selectForwardableHeaders`, so a
 * fingerprint describes the byte-exact value the Broadcast contributes to a
 * delivery — allow-list matching, multi-value joining, and the `authorization`
 * backstop included — rather than a second, drifting reading of the same rule.
 * It is a fingerprint of what the *producer presented*, which is the question
 * being asked; ADR 0016 lets an Endpoint's own `endpoint.headers` override a
 * forwarded name on the wire, so for that one Endpoint the delivered value can
 * differ from this digest by the operator's own configuration.
 *
 * Returns `undefined` — an absent field, not an empty one — when the Channel
 * asks to forward nothing, keeping those responses exactly as they were before
 * this existed. That is a different answer from `[]`, which says the Channel
 * does forward headers but this Broadcast stored none of them: itself a
 * finding, since ADR 0002's ingest filter bounds what the allow-list can ever
 * select. Both answers are decided here rather than at the call site, so the
 * distinction has one owner.
 */
export function fingerprintForwardedHeaders(
  broadcastHeaders: Record<string, string | string[]>,
  forwardHeaders: string[],
): ForwardedHeaderFingerprint[] | undefined {
  if (normalizeForwardAllowlist(forwardHeaders).size === 0) {
    return undefined;
  }

  return (
    Object.entries(selectForwardableHeaders(broadcastHeaders, forwardHeaders))
      .map(([name, value]) => ({
        name,
        fingerprint: createHash("sha256")
          .update(value, "utf8")
          .digest("hex")
          .slice(0, FORWARDED_HEADER_FINGERPRINT_LENGTH),
      }))
      // Stable order so two broadcasts on the same Channel stay diffable by eye.
      .sort((a, b) => a.name.localeCompare(b.name))
  );
}
