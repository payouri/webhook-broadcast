const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * Issue #54: an operator's question about a Broadcast, Attempt, ingest token,
 * or auto-disable is "how long ago", not "what o'clock" — `toLocaleString()`
 * answers the wrong question and costs more grid width doing it. This is the
 * one place that arithmetic happens, so every row family reads it the same
 * way and a rounding-boundary fix (`Math.floor`, not `Math.round`, so "59s
 * ago" never reads as "a minute from now") is made once.
 *
 * A future timestamp (clock skew between browser and server, or a fixture
 * slightly ahead of "now") folds into "just now" rather than surfacing a
 * negative duration an operator would have to puzzle over.
 */
export function formatElapsed(iso: string, now: number): string {
  const diff = now - new Date(iso).getTime();
  if (diff < 10 * SECOND) {
    return "just now";
  }
  if (diff < MINUTE) {
    return `${Math.floor(diff / SECOND)}s ago`;
  }
  if (diff < HOUR) {
    return `${Math.floor(diff / MINUTE)}m ago`;
  }
  if (diff < DAY) {
    return `${Math.floor(diff / HOUR)}h ago`;
  }
  if (diff < MONTH) {
    return `${Math.floor(diff / DAY)}d ago`;
  }
  if (diff < YEAR) {
    return `${Math.floor(diff / MONTH)}mo ago`;
  }
  return `${Math.floor(diff / YEAR)}y ago`;
}

/** The exact instant, in the operator's own locale — what `formatElapsed` replaced as the primary reading, kept on demand. */
export function formatAbsolute(iso: string): string {
  return new Date(iso).toLocaleString();
}

/**
 * Issue #75: the gap between two Attempts — ADR 0003's exponential backoff
 * with jitter, read back from the actual timestamps rather than recomputed
 * from the policy inputs, so it reflects what really happened (a `Retry-After`
 * override, or jitter landing near zero) rather than the nominal curve. Never
 * negative on screen: attempts are recorded in order, but a clock oddity folds
 * to "0s" rather than a confusing negative duration.
 *
 * Truncates rather than rounds, for the same reason `formatElapsed` above does:
 * rounding a remainder can carry it past its own unit, so 59.6s reads "60s"
 * instead of "1m", and 59m 59.6s reads "59m 60s". Truncation keeps every
 * component strictly inside its unit and keeps the sequence monotonic, which is
 * the whole point of a column an operator reads down.
 */
export function formatBackoffGap(ms: number): string {
  const clamped = Math.max(0, ms);
  if (clamped < SECOND) {
    return "<1s";
  }
  if (clamped < MINUTE) {
    return `${Math.floor(clamped / SECOND)}s`;
  }
  if (clamped < HOUR) {
    const minutes = Math.floor(clamped / MINUTE);
    const seconds = Math.floor((clamped % MINUTE) / SECOND);
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(clamped / HOUR);
  const minutes = Math.floor((clamped % HOUR) / MINUTE);
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}
