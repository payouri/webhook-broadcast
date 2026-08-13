import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Database } from "../client.js";
import { attempts, broadcasts, channels, deliveries, endpoints } from "../schema.js";

export type DeliveryStatus = (typeof deliveries.$inferSelect)["status"];

/**
 * Issue #44: the single documented window for the Channel directory's
 * failure signal — how far back a `failed`/`dead_lettered` Delivery still
 * counts toward "recent". One constant used by the aggregate query below;
 * nothing else recomputes or restates this number.
 */
export const CHANNEL_RECENT_FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface ChannelRecentFailureCountRow {
  failedCount: number;
  deadLetteredCount: number;
}

export interface DeliveryRow {
  id: string;
  broadcastId: string;
  endpointId: string;
  channelId: string;
  status: DeliveryStatus;
  attemptCount: number;
  lastStatusCode: number | null;
  lastDurationMs: number | null;
  lastError: string | null;
  updatedAt: Date;
}

/**
 * One Delivery per (Broadcast, Endpoint) pair, snapshotting the Endpoints
 * enabled on the Channel at accept time (CONTEXT.md's Broadcast/Delivery
 * language) — bulk-inserted so ingest enqueues from a single round trip.
 */
export async function createDeliveriesForBroadcast(
  db: Database,
  input: { broadcastId: string; channelId: string; endpointIds: string[]; now: Date },
): Promise<DeliveryRow[]> {
  if (input.endpointIds.length === 0) {
    return [];
  }
  return db
    .insert(deliveries)
    .values(
      input.endpointIds.map((endpointId) => ({
        id: randomUUID(),
        broadcastId: input.broadcastId,
        endpointId,
        channelId: input.channelId,
        status: "pending" as const,
        attemptCount: 0,
        updatedAt: input.now,
      })),
    )
    .returning();
}

export interface DeliveryForProcessing {
  id: string;
  endpointId: string;
  status: DeliveryStatus;
  attemptCount: number;
  endpoint: { url: string; headers: Record<string, string>; timeoutMs: number | null };
  broadcast: {
    contentType: string;
    body: Buffer;
    headers: Record<string, string | string[]>;
  };
  /** Issue #37: the Channel's forwardable inbound-header allow-list. */
  channel: { forwardHeaders: string[] };
}

/**
 * Everything the worker needs for one HTTP Attempt, joined from the
 * Delivery id alone — the BullMQ job payload only carries `deliveryId`, so
 * this is the worker's sole read before dialing out.
 */
export async function getDeliveryForProcessing(
  db: Database,
  deliveryId: string,
): Promise<DeliveryForProcessing | undefined> {
  const [row] = await db
    .select({
      id: deliveries.id,
      endpointId: deliveries.endpointId,
      status: deliveries.status,
      attemptCount: deliveries.attemptCount,
      endpointUrl: endpoints.url,
      endpointHeaders: endpoints.headers,
      endpointTimeoutMs: endpoints.timeoutMs,
      broadcastContentType: broadcasts.contentType,
      broadcastBody: broadcasts.body,
      broadcastHeaders: broadcasts.headers,
      channelForwardHeaders: channels.forwardHeaders,
    })
    .from(deliveries)
    .innerJoin(endpoints, eq(endpoints.id, deliveries.endpointId))
    .innerJoin(broadcasts, eq(broadcasts.id, deliveries.broadcastId))
    .innerJoin(channels, eq(channels.id, deliveries.channelId))
    .where(eq(deliveries.id, deliveryId));

  if (!row) {
    return undefined;
  }
  return {
    id: row.id,
    endpointId: row.endpointId,
    status: row.status,
    attemptCount: row.attemptCount,
    endpoint: {
      url: row.endpointUrl,
      headers: row.endpointHeaders,
      timeoutMs: row.endpointTimeoutMs,
    },
    broadcast: {
      contentType: row.broadcastContentType,
      body: row.broadcastBody,
      headers: row.broadcastHeaders,
    },
    channel: { forwardHeaders: row.channelForwardHeaders },
  };
}

/**
 * Claims a Delivery for one Attempt. The normal path is `pending` →
 * `in_progress`; a stale BullMQ redelivery after a worker crash (still
 * `in_progress`) is re-admitted so the Attempt can resume instead of
 * staying stuck forever.
 */
export async function markDeliveryInProgress(
  db: Database,
  deliveryId: string,
  updatedAt: Date,
): Promise<boolean> {
  const rows = await db
    .update(deliveries)
    .set({ status: "in_progress", updatedAt })
    .where(and(eq(deliveries.id, deliveryId), eq(deliveries.status, "pending")))
    .returning({ id: deliveries.id });
  if (rows.length > 0) {
    return true;
  }
  const [existing] = await db
    .select({ status: deliveries.status })
    .from(deliveries)
    .where(eq(deliveries.id, deliveryId));
  return existing?.status === "in_progress";
}

/**
 * Releases a stuck `in_progress` claim back to `pending` when the worker
 * could not persist the Attempt outcome — keeps BullMQ redelivery viable.
 */
export async function resetInProgressDeliveryToPending(
  db: Database,
  deliveryId: string,
  updatedAt: Date,
): Promise<boolean> {
  const rows = await db
    .update(deliveries)
    .set({ status: "pending", updatedAt })
    .where(and(eq(deliveries.id, deliveryId), eq(deliveries.status, "in_progress")))
    .returning({ id: deliveries.id });
  return rows.length > 0;
}

/**
 * Records one Attempt and the Delivery's resulting status in one
 * transaction — the Attempt row is written every try, so the timeline grows
 * across retries (ADR 0003) even though only the final call for a given
 * Delivery lands on a terminal `status` (`succeeded` | `failed` |
 * `dead_lettered`); a retryable-but-not-exhausted outcome instead passes
 * `status: "pending"` so the next Attempt can be picked up (worker-side
 * `markDeliveryInProgress` guards on that).
 */
export async function completeDelivery(
  db: Database,
  input: {
    deliveryId: string;
    n: number;
    statusCode: number | null;
    durationMs: number;
    error: string | null;
    status: DeliveryStatus;
    at: Date;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(attempts).values({
      id: randomUUID(),
      deliveryId: input.deliveryId,
      n: input.n,
      statusCode: input.statusCode,
      durationMs: input.durationMs,
      error: input.error,
      at: input.at,
    });
    await tx
      .update(deliveries)
      .set({
        status: input.status,
        attemptCount: input.n,
        lastStatusCode: input.statusCode,
        lastDurationMs: input.durationMs,
        lastError: input.error,
        updatedAt: input.at,
      })
      .where(eq(deliveries.id, input.deliveryId));
  });
}

export interface DeliveryWithEndpointRow {
  id: string;
  endpointId: string;
  endpointName: string | null;
  endpointUrl: string;
  status: DeliveryStatus;
  attemptCount: number;
  lastStatusCode: number | null;
  lastDurationMs: number | null;
  lastError: string | null;
  updatedAt: Date;
}

/** Broadcast detail's Delivery list, ordered by Endpoint for a stable read. */
export async function listDeliveriesForBroadcast(
  db: Database,
  broadcastId: string,
): Promise<DeliveryWithEndpointRow[]> {
  const rows = await db
    .select({
      id: deliveries.id,
      endpointId: deliveries.endpointId,
      endpointName: endpoints.name,
      endpointUrl: endpoints.url,
      status: deliveries.status,
      attemptCount: deliveries.attemptCount,
      lastStatusCode: deliveries.lastStatusCode,
      lastDurationMs: deliveries.lastDurationMs,
      lastError: deliveries.lastError,
      updatedAt: deliveries.updatedAt,
    })
    .from(deliveries)
    .innerJoin(endpoints, eq(endpoints.id, deliveries.endpointId))
    .where(eq(deliveries.broadcastId, broadcastId))
    .orderBy(asc(endpoints.url), asc(deliveries.id));
  return rows;
}

export interface DeliveryDetailRow {
  id: string;
  broadcastId: string;
  channelId: string;
  endpointId: string;
  endpointName: string | null;
  endpointUrl: string;
  status: DeliveryStatus;
  attemptCount: number;
  lastStatusCode: number | null;
  lastDurationMs: number | null;
  lastError: string | null;
  updatedAt: Date;
}

/** Delivery detail (issue #21 AC): Endpoint identity plus current status, addressed by id alone. */
export async function getDeliveryDetailById(
  db: Database,
  deliveryId: string,
): Promise<DeliveryDetailRow | undefined> {
  const [row] = await db
    .select({
      id: deliveries.id,
      broadcastId: deliveries.broadcastId,
      channelId: deliveries.channelId,
      endpointId: deliveries.endpointId,
      endpointName: endpoints.name,
      endpointUrl: endpoints.url,
      status: deliveries.status,
      attemptCount: deliveries.attemptCount,
      lastStatusCode: deliveries.lastStatusCode,
      lastDurationMs: deliveries.lastDurationMs,
      lastError: deliveries.lastError,
      updatedAt: deliveries.updatedAt,
    })
    .from(deliveries)
    .innerJoin(endpoints, eq(endpoints.id, deliveries.endpointId))
    .where(eq(deliveries.id, deliveryId));
  return row;
}

export interface AttemptRow {
  id: string;
  n: number;
  statusCode: number | null;
  durationMs: number | null;
  error: string | null;
  at: Date;
}

/** Delivery detail's Attempt timeline (issue #21 AC), oldest-first. */
export async function listAttemptsForDelivery(
  db: Database,
  deliveryId: string,
): Promise<AttemptRow[]> {
  return db
    .select({
      id: attempts.id,
      n: attempts.n,
      statusCode: attempts.statusCode,
      durationMs: attempts.durationMs,
      error: attempts.error,
      at: attempts.at,
    })
    .from(attempts)
    .where(eq(attempts.deliveryId, deliveryId))
    .orderBy(asc(attempts.n));
}

/**
 * Re-queues a `dead_lettered` Delivery (ADR 0003: distinct from Broadcast
 * replay) — guarded on the current status so a racing worker/second retry
 * click can't push an already `pending`/`in_progress` Delivery backwards.
 * `attemptCount` is left as-is: the next Attempt's `n` keeps counting up
 * (the `attempt_delivery_id_n_key` unique index forbids reusing an `n`
 * already written), and a fresh 2xx still lands `succeeded` regardless.
 */
export async function retryDeadLetteredDelivery(
  db: Database,
  deliveryId: string,
  updatedAt: Date,
): Promise<boolean> {
  const rows = await db
    .update(deliveries)
    .set({ status: "pending", updatedAt })
    .where(and(eq(deliveries.id, deliveryId), eq(deliveries.status, "dead_lettered")))
    .returning({ id: deliveries.id });
  return rows.length > 0;
}

/**
 * Channel directory failure signal (issue #44): one grouped query for every
 * requested Channel, never one query per Channel. Counts `failed` and
 * `dead_lettered` Deliveries whose `updatedAt` falls inside
 * `CHANNEL_RECENT_FAILURE_WINDOW_MS` of `now`. Every status transition writes
 * `updatedAt` (see `completeDelivery`), so it is when the Delivery entered its
 * terminal state — a re-queued `dead_lettered` Delivery (ADR 0003) bumps it
 * again and drops out of the count, which is what an operator wants.
 *
 * `now` is caller-supplied so the window is deterministic under test rather
 * than reading the wall clock inside the query. Both statuses are also filtered
 * in the `where`, so the scan touches only failure rows; a Channel with nothing
 * failed recently (or no Deliveries at all) is therefore absent from the
 * returned Map entirely, and callers treat a missing entry as zero.
 */
export async function getRecentFailureCountsByChannelIds(
  db: Database,
  channelIds: string[],
  now: Date,
): Promise<Map<string, ChannelRecentFailureCountRow>> {
  if (channelIds.length === 0) {
    return new Map();
  }
  const since = new Date(now.getTime() - CHANNEL_RECENT_FAILURE_WINDOW_MS);
  const rows = await db
    .select({
      channelId: deliveries.channelId,
      failedCount: sql<number>`count(*) filter (where ${deliveries.status} = 'failed')`.mapWith(
        Number,
      ),
      deadLetteredCount:
        sql<number>`count(*) filter (where ${deliveries.status} = 'dead_lettered')`.mapWith(Number),
    })
    .from(deliveries)
    .where(
      and(
        inArray(deliveries.channelId, channelIds),
        inArray(deliveries.status, ["failed", "dead_lettered"]),
        gte(deliveries.updatedAt, since),
      ),
    )
    .groupBy(deliveries.channelId);
  return new Map(
    rows.map((row) => [
      row.channelId,
      { failedCount: row.failedCount, deadLetteredCount: row.deadLetteredCount },
    ]),
  );
}
