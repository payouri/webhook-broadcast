/** ADR 0004: Channel list, activity, endpoints, and Broadcast deliveries refresh ~every 5s. */
export const FRESHNESS_POLL_MS = 5_000;

/** Same "Failed to load X" fallback the manual fetch effects used, for TanStack Query errors. */
export function queryErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
