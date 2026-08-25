import { createHash } from "node:crypto";

/**
 * The expected forwarded-header fingerprint (issue #112), computed
 * independently of `fingerprintForwardedHeaders` so a test asserting against
 * it is real evidence rather than the implementation agreeing with itself.
 * Shared by the unit and HTTP-seam suites so the oracle is written once.
 */
export function sha256Prefix(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12);
}
