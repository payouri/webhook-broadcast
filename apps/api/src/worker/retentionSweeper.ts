import { deleteBroadcastsReceivedBefore, type Database } from "@webhook-broadcast/db";

/** Default cadence for the in-worker retention interval (ADR 0008). */
export const DEFAULT_RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export interface RunRetentionSweepInput {
  db: Database;
  retentionDays: number;
  now?: Date;
}

/**
 * One prune pass: drop Broadcasts whose `receivedAt` falls outside the
 * HISTORY_RETENTION_DAYS window (ADR 0002). Child Deliveries/Attempts go
 * with the Broadcast via FK cascade (ADR 0007).
 */
export async function runRetentionSweep(input: RunRetentionSweepInput): Promise<number> {
  const now = input.now ?? new Date();
  const cutoff = new Date(now.getTime() - input.retentionDays * 24 * 60 * 60 * 1000);
  return deleteBroadcastsReceivedBefore(input.db, cutoff);
}

export interface StartRetentionSweeperInput {
  db: Database;
  retentionDays: number;
  intervalMs?: number;
  now?: () => Date;
  onError?: (error: unknown) => void;
}

export interface RetentionSweeper {
  stop: () => void;
}

/**
 * Interval-driven retention prune hosted inside the worker process
 * (ADR 0008). Errors are logged via `onError` so a failed sweep never
 * takes down the Delivery worker.
 */
export function startRetentionSweeper(input: StartRetentionSweeperInput): RetentionSweeper {
  const intervalMs = input.intervalMs ?? DEFAULT_RETENTION_SWEEP_INTERVAL_MS;
  const now = input.now ?? (() => new Date());
  const onError =
    input.onError ??
    ((error: unknown) => {
      console.error(JSON.stringify({ msg: "retention sweeper failed", error: String(error) }));
    });

  const tick = (): void => {
    void runRetentionSweep({
      db: input.db,
      retentionDays: input.retentionDays,
      now: now(),
    }).catch(onError);
  };

  // Prune once at worker boot, then on the cadence — a long-lived process
  // should not wait a full interval after every deploy before catching up.
  tick();
  const handle = setInterval(tick, intervalMs);
  // Unref so the timer alone cannot keep a draining worker alive after
  // SIGTERM closes the BullMQ worker + pool.
  if (typeof handle.unref === "function") {
    handle.unref();
  }

  return {
    stop: () => {
      clearInterval(handle);
    },
  };
}
