/**
 * Issue #37: per-Channel allow-list of inbound header names forwarded to
 * every Endpoint on delivery. Empty allow-list = forward nothing (current
 * behaviour for every existing Channel, unchanged).
 *
 * "authorization" is refused even if named in the allow-list — that header
 * carries the Channel's own ingest token (ADR 0002), and blanket-forwarding
 * it would hand every fan-out Endpoint write access on the Channel instead
 * of the read-only fan-out subscription it's meant to be. Contract-level
 * validation (`channelCreateSchema`/`channelUpdateSchema`) already rejects
 * it at configuration time; this is the delivery-time backstop in case a
 * Channel row ever carries it some other way (direct DB write, older data).
 */
const NEVER_FORWARD = new Set(["authorization"]);

/**
 * Picks the subset of a Broadcast's stored inbound headers (ADR 0002) named
 * on the Channel's `forwardHeaders` allow-list, matched case-insensitively.
 * A stored multi-value header is joined with `", "` — the same
 * representation a single outbound `fetch` header value can carry.
 */
export function selectForwardableHeaders(
  broadcastHeaders: Record<string, string | string[]>,
  allowlist: string[],
): Record<string, string> {
  const allowSet = new Set(
    allowlist
      .map((name) => name.trim().toLowerCase())
      .filter((name) => name.length > 0 && !NEVER_FORWARD.has(name)),
  );
  if (allowSet.size === 0) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(broadcastHeaders)) {
    const lowerKey = key.toLowerCase();
    if (!allowSet.has(lowerKey) || NEVER_FORWARD.has(lowerKey)) {
      continue;
    }
    result[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return result;
}
