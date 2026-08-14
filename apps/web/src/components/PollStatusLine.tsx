import { derivePollStatus } from "../lib/pollStatus.js";
import { ElapsedTime } from "./ElapsedTime.js";

/**
 * Issue #54: states when a polled list last refreshed successfully, and
 * names a failing poll instead of letting it read as a quiet system.
 *
 * `role="status"` (polite), never `role="alert"` — PRODUCT.md principle 4,
 * "failure is information, not alarm", applies to the poll itself as much as
 * to any Delivery it reports on. The live region wraps only the fixed
 * "Updates failing" sentence, not the elapsed reading beside it: a polite
 * region announces its content again every time that content changes, and the
 * elapsed label ticks every 30s, so putting the tick inside the region would
 * re-announce the same failure indefinitely — volume, which is the thing
 * principle 4 rules out. Announced once when it appears, then quiet.
 *
 * The failing branch reuses `.error-text`'s
 * Lamp Cut color, the same vocabulary an inline load error already carries
 * elsewhere on this page, rather than inventing a second failure color; the
 * only new thing here is the sentence, not the palette. Recovery needs no
 * action from this component at all: it re-derives from the query's own
 * `dataUpdatedAt`/`isError` on every render, and the poll (`freshness.ts`)
 * keeps retrying on its own ~5s interval, so the next successful fetch clears
 * the failing state the same render it lands.
 */
export function PollStatusLine({
  dataUpdatedAt,
  isError,
}: {
  dataUpdatedAt: number;
  isError: boolean;
}) {
  const status = derivePollStatus({ dataUpdatedAt, isError });
  if (status.state === "unknown") {
    return null;
  }
  const iso = new Date(status.lastUpdatedAt).toISOString();
  if (status.state === "failing") {
    return (
      <p className="poll-status poll-status-failing">
        <span role="status">Updates failing</span> — showing data from <ElapsedTime iso={iso} />.
      </p>
    );
  }
  return (
    <p className="poll-status muted">
      Updated <ElapsedTime iso={iso} />.
    </p>
  );
}
