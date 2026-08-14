import { useEffect, useRef } from "react";
import { describeApiError } from "./api.js";

/** ADR 0004: Channel list, activity, Endpoints, and Broadcast deliveries refresh ~every 5s. */
export const FRESHNESS_POLL_MS = 5_000;

/**
 * The "Failed to load X" naming a query's error banner shows. A thin alias for
 * `describeApiError` so a load failure and a mutation failure are described by
 * one rule (issue #58); the separate name is what the query call sites read as.
 */
export function queryErrorMessage(error: unknown, fallback: string): string {
  return describeApiError(error, fallback);
}

/**
 * ~5s while the tab is visible, paused while it is hidden: a backgrounded
 * dashboard has no one reading it, so there is no reason to keep refetching
 * every list on a timer nobody can see.
 */
export function freshnessRefetchInterval(): number | false {
  return document.visibilityState === "hidden" ? false : FRESHNESS_POLL_MS;
}

/**
 * Fires `refetch` the moment the tab regains visibility, so polling resumes
 * with an immediate, fresh fetch rather than waiting out whatever was left of
 * the paused interval.
 *
 * Callers pass a fresh closure every render, so the latest one is held in a ref
 * and the listener is registered once for the component's lifetime rather than
 * torn down and re-added on every render.
 */
export function useRefetchOnVisible(refetch: () => unknown): void {
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);

  useEffect(() => {
    function handleVisibilityChange(): void {
      if (document.visibilityState === "visible") {
        refetchRef.current();
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);
}
