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
