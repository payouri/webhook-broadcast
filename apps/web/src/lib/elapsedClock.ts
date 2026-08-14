import { useSyncExternalStore } from "react";

/**
 * One shared "now" ticking every 30s (issue #54), read by every `ElapsedTime`
 * on screen through `useSyncExternalStore`. The naive version of this feature
 * — each row's own `setInterval` — is the re-render storm the issue's
 * acceptance criteria explicitly rules out: a busy Activity page can hold
 * dozens of elapsed timestamps, and dozens of independent per-second timers
 * each forcing their own render is exactly the "instrument that twitches"
 * PRODUCT.md principle 6 warns against. One timer, ticking coarsely enough
 * that "elapsed" never needs finer resolution than a row already rounds to,
 * updates every subscriber's snapshot at once and lets React batch the renders.
 *
 * Paused while the tab is hidden, on the same reasoning `freshness.ts` already
 * applies to polling: nobody is reading a backgrounded tab's elapsed labels,
 * so there is nothing to tick for. Regaining visibility ticks immediately so a
 * long-hidden tab does not show a stale "3m ago" for up to 30s after it comes
 * back — the same "refetch on visible" idea `useRefetchOnVisible` applies to
 * polling, applied here to the clock instead.
 */
const TICK_MS = 30_000;

type Listener = () => void;

const listeners = new Set<Listener>();
let now = Date.now();
let intervalId: ReturnType<typeof setInterval> | null = null;

function tick(): void {
  now = Date.now();
  for (const listener of listeners) {
    listener();
  }
}

function startTicking(): void {
  if (intervalId !== null || typeof document === "undefined") {
    return;
  }
  if (document.visibilityState === "hidden") {
    return;
  }
  intervalId = setInterval(tick, TICK_MS);
}

function stopTicking(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      stopTicking();
    } else {
      tick();
      startTicking();
    }
  });
}

function subscribe(listener: Listener): () => void {
  // The first subscriber after a quiet spell (module import, or every prior
  // `ElapsedTime` having unmounted) resyncs `now` to the real clock rather
  // than whatever it last was: without this, a page that imports this module
  // once at startup and only mounts its first timestamp minutes later would
  // read every elapsed label as measured from that stale import-time instant.
  // `useSyncExternalStore` re-reads the snapshot immediately after `subscribe`
  // returns and re-renders if it changed, so this alone is enough — no manual
  // notify needed for the subscribing component itself.
  if (listeners.size === 0) {
    now = Date.now();
  }
  listeners.add(listener);
  startTicking();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopTicking();
    }
  };
}

function getSnapshot(): number {
  return now;
}

/** The shared elapsed-time clock (issue #54). Re-renders only the components that read it, on one shared 30s tick. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
