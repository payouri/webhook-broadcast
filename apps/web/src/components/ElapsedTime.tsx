import { useId } from "react";
import { useNow } from "../lib/elapsedClock.js";
import { formatAbsolute, formatElapsed } from "../lib/relativeTime.js";

/**
 * Issue #54: every row that used to print `new Date(...).toLocaleString()`
 * reads elapsed time instead — shorter, and it answers "how long ago" without
 * arithmetic. The exact instant stays available in the CSS-revealed
 * `.elapsed-time-exact` bubble, on the terms DESIGN.md §4 sets for the one
 * floating surface it grants. A native `title` attribute was rejected for the
 * same reason `ChannelDetailPage`'s unauthenticated-ingest tag rejected one
 * (see its own comment) — it is invisible to keyboard and touch and
 * inconsistently announced by screen readers, and this fact is exactly the one
 * the operator reaches for when the relative form alone is not enough.
 *
 * `<time dateTime>` (not a `span`) so the exact instant is in the markup for
 * anything that reads it structurally, independent of whether the CSS
 * disclosure is open.
 *
 * `focusable` names who owns the tab stop that reveals the bubble:
 *
 * - `true` (the default, for a timestamp sitting in ordinary non-interactive
 *   text): this `<time>` owns it. `tabIndex={0}` gives it a focus state, and
 *   `aria-describedby` points at the bubble so the exact instant is announced
 *   too — a directly-referenced element counts toward the description even
 *   while CSS keeps it hidden, so this holds whether the bubble is revealed or
 *   not.
 * - `false`, for the Activity and Endpoint rows, whose row is itself a
 *   `<button>`: a focusable descendant of a button is a nested interactive
 *   control — the button's content is flattened for assistive tech, so the
 *   nested stop is not properly exposed, and it costs one extra Tab press per
 *   row on the two busiest lists. The row already owns a tab stop, so the CSS
 *   reveals the bubble from `.row:focus-visible` instead and the bubble is
 *   `aria-hidden` (the row's own name already carries the elapsed reading).
 */
export function ElapsedTime({
  iso,
  className,
  focusable = true,
}: {
  iso: string;
  className?: string;
  focusable?: boolean;
}) {
  const now = useNow();
  const exactId = useId();
  const absolute = formatAbsolute(iso);
  return (
    <time
      dateTime={iso}
      className={className ? `elapsed-time ${className}` : "elapsed-time"}
      {...(focusable ? { tabIndex: 0, "aria-describedby": exactId } : {})}
    >
      {formatElapsed(iso, now)}
      {focusable ? (
        <span className="elapsed-time-exact" id={exactId} role="tooltip">
          {absolute}
        </span>
      ) : (
        <span className="elapsed-time-exact" aria-hidden="true">
          {absolute}
        </span>
      )}
    </time>
  );
}
