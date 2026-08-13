import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { Database } from "../client.js";
import { broadcasts, deliveries } from "../schema.js";

export interface BroadcastRow {
  id: string;
  channelId: string;
  receivedAt: Date;
  contentType: string;
  body: Buffer;
  headers: Record<string, string | string[]>;
}

export async function insertBroadcast(
  db: Database,
  input: {
    id: string;
    channelId: string;
    receivedAt: Date;
    contentType: string;
    body: Buffer;
    headers: Record<string, string | string[]>;
  },
): Promise<BroadcastRow> {
  const [row] = await db.insert(broadcasts).values(input).returning();
  if (!row) {
    throw new Error("insert returned no row");
  }
  return row;
}

export interface BroadcastCursor {
  receivedAt: string;
  id: string;
}

export function encodeBroadcastCursor(cursor: BroadcastCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeBroadcastCursor(cursor: string): BroadcastCursor | undefined {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "receivedAt" in parsed &&
      "id" in parsed &&
      typeof (parsed as { receivedAt: unknown }).receivedAt === "string" &&
      typeof (parsed as { id: unknown }).id === "string"
    ) {
      return parsed as BroadcastCursor;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Newest-first keyset pagination on `(received_at, id)` (ADR 0007's
 * `broadcast_channel_received_id_idx`) — offset paging would thrash under
 * the ~5s Activity poll as new Broadcasts keep arriving at the head.
 */
export async function listBroadcastsByChannel(
  db: Database,
  options: { channelId: string; cursor?: BroadcastCursor | undefined; limit: number },
): Promise<{ items: BroadcastRow[]; nextCursor: BroadcastCursor | null }> {
  const { channelId, cursor, limit } = options;
  const cursorReceivedAt = cursor ? new Date(cursor.receivedAt) : undefined;

  const rows = await db
    .select()
    .from(broadcasts)
    .where(
      and(
        eq(broadcasts.channelId, channelId),
        cursor && cursorReceivedAt
          ? or(
              lt(broadcasts.receivedAt, cursorReceivedAt),
              and(eq(broadcasts.receivedAt, cursorReceivedAt), lt(broadcasts.id, cursor.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(broadcasts.receivedAt), desc(broadcasts.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last ? { receivedAt: last.receivedAt.toISOString(), id: last.id } : null;
  return { items, nextCursor };
}

export async function getBroadcastById(
  db: Database,
  channelId: string,
  id: string,
): Promise<BroadcastRow | undefined> {
  const [row] = await db
    .select()
    .from(broadcasts)
    .where(and(eq(broadcasts.channelId, channelId), eq(broadcasts.id, id)));
  return row;
}

/** Removes one Broadcast; Deliveries and Attempts cascade (ADR 0007). */
export async function deleteBroadcastById(db: Database, id: string): Promise<boolean> {
  const deleted = await db
    .delete(broadcasts)
    .where(eq(broadcasts.id, id))
    .returning({ id: broadcasts.id });
  return deleted.length > 0;
}

/**
 * Retention prune (ADR 0002 / ADR 0007): delete Broadcasts with
 * `received_at` strictly before `cutoff`. Deliveries and Attempts cascade
 * via `ON DELETE CASCADE` on the FK edges.
 */
export async function deleteBroadcastsReceivedBefore(db: Database, cutoff: Date): Promise<number> {
  const deleted = await db
    .delete(broadcasts)
    .where(lt(broadcasts.receivedAt, cutoff))
    .returning({ id: broadcasts.id });
  return deleted.length;
}

/**
 * Channel directory (issue #44): which of these Channels have ever received
 * a Broadcast at all, distinguishing "no activity" from "healthy" — a
 * Channel can have zero recent failures either because it is fine or because
 * it has never taken any traffic, and those two must not render the same.
 * One grouped query for every requested Channel, never one per Channel.
 */
export async function getChannelIdsWithAnyBroadcast(
  db: Database,
  channelIds: string[],
): Promise<Set<string>> {
  if (channelIds.length === 0) {
    return new Set();
  }
  const rows = await db
    .select({ channelId: broadcasts.channelId })
    .from(broadcasts)
    .where(inArray(broadcasts.channelId, channelIds))
    .groupBy(broadcasts.channelId);
  return new Set(rows.map((row) => row.channelId));
}

export interface FanoutSummaryRow {
  total: number;
  succeeded: number;
  failed: number;
  deadLettered: number;
  pending: number;
}

export const EMPTY_FANOUT_SUMMARY: FanoutSummaryRow = {
  total: 0,
  succeeded: 0,
  failed: 0,
  deadLettered: 0,
  pending: 0,
};

/**
 * Fan-out is computed in SQL from Delivery rows, never stored on Broadcast
 * (ADR 0007) — Delivery creation lands with the fan-out/queue slice, so this
 * returns `EMPTY_FANOUT_SUMMARY` for Broadcasts with no Delivery rows yet.
 */
export async function getFanoutSummariesByBroadcastIds(
  db: Database,
  broadcastIds: string[],
): Promise<Map<string, FanoutSummaryRow>> {
  if (broadcastIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      broadcastId: deliveries.broadcastId,
      total: sql<number>`count(*)`.mapWith(Number),
      succeeded: sql<number>`count(*) filter (where ${deliveries.status} = 'succeeded')`.mapWith(
        Number,
      ),
      failed: sql<number>`count(*) filter (where ${deliveries.status} = 'failed')`.mapWith(Number),
      deadLettered:
        sql<number>`count(*) filter (where ${deliveries.status} = 'dead_lettered')`.mapWith(Number),
      pending:
        sql<number>`count(*) filter (where ${deliveries.status} in ('pending', 'in_progress'))`.mapWith(
          Number,
        ),
    })
    .from(deliveries)
    .where(inArray(deliveries.broadcastId, broadcastIds))
    .groupBy(deliveries.broadcastId);

  return new Map(
    rows.map((row) => [
      row.broadcastId,
      {
        total: row.total,
        succeeded: row.succeeded,
        failed: row.failed,
        deadLettered: row.deadLettered,
        pending: row.pending,
      },
    ]),
  );
}
