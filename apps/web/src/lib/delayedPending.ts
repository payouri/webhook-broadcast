import { useEffect, useRef, useState } from "react";

/**
 * DESIGN.md §5, the No-Flicker Rule: the two thresholds live here as tokens,
 * never as literals at a call site.
 */
export const PENDING_DELAY_MS = 250;
export const PENDING_HOLD_MS = 400;

/**
 * The shared delay-and-hold hook the No-Flicker Rule requires (DESIGN.md §5).
 * `isPending` from a mutation, a fetch, or a local "is this control mid-click"
 * flag is never rendered directly — it passes through here first, and this
 * hook's return value is the only thing a component reads for a waiting
 * state:
 *
 * - **Delay.** `isPending` turning true is held back for `PENDING_DELAY_MS`.
 *   If it turns false again before the delay elapses (the common case for a
 *   healthy local fan-out), nothing is ever shown — the row underneath just
 *   changes.
 * - **Hold.** Once shown, the waiting state stays for at least
 *   `PENDING_HOLD_MS`, even if `isPending` goes false sooner. The hold
 *   applies to whatever replaces it once it ends: content, an empty state,
 *   or an error.
 *
 * A control that resolves in 80ms never renders its pending label. A control
 * that is genuinely slow shows it at 250ms and holds it for at least 400ms.
 */
export function useDelayedPending(isPending: boolean): boolean {
  const [visible, setVisible] = useState(false);
  const shownAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (isPending) {
      const delayTimer = setTimeout(() => {
        shownAtRef.current = Date.now();
        setVisible(true);
      }, PENDING_DELAY_MS);
      return () => clearTimeout(delayTimer);
    }

    const shownAt = shownAtRef.current;
    if (shownAt === null) {
      // Never made it past the delay: nothing was shown, nothing to hold.
      setVisible(false);
      return;
    }

    const remaining = PENDING_HOLD_MS - (Date.now() - shownAt);
    if (remaining <= 0) {
      shownAtRef.current = null;
      setVisible(false);
      return;
    }

    const holdTimer = setTimeout(() => {
      shownAtRef.current = null;
      setVisible(false);
    }, remaining);
    return () => clearTimeout(holdTimer);
  }, [isPending]);

  return visible;
}
