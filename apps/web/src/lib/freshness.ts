import { useEffect } from "react";

/** ADR 0004: Channel list, activity, endpoints, and Broadcast deliveries refresh ~every 5s. */
export const FRESHNESS_POLL_MS = 5_000;

/** Initial fetch plus interval polling — same shape as TanStack Query `refetchInterval`. */
export function usePolling(load: () => void | Promise<void>): void {
  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), FRESHNESS_POLL_MS);
    return () => clearInterval(interval);
  }, [load]);
}
