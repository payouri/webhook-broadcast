import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { attempts, broadcasts, deliveries, endpoints } from "../schema.js";

export type DeliveryStatus = (typeof deliveries.$inferSelect)["status"];

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
  status: DeliveryStatus;
  attemptCount: number;
  endpoint: { url: string; headers: Record<string, string>; timeoutMs: number | null };
  broadcast: { contentType: string; body: Buffer };
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
      status: deliveries.status,
      attemptCount: deliveries.attemptCount,
      endpointUrl: endpoints.url,
      endpointHeaders: endpoints.headers,
      endpointTimeoutMs: endpoints.timeoutMs,
      broadcastContentType: broadcasts.contentType,
      broadcastBody: broadcasts.body,
    })
    .from(deliveries)
    .innerJoin(endpoints, eq(endpoints.id, deliveries.endpointId))
    .innerJoin(broadcasts, eq(broadcasts.id, deliveries.broadcastId))
    .where(eq(deliveries.id, deliveryId));

  if (!row) {
    return undefined;
  }
  return {
    id: row.id,
    status: row.status,
    attemptCount: row.attemptCount,
    endpoint: {
      url: row.endpointUrl,
      headers: row.endpointHeaders,
      timeoutMs: row.endpointTimeoutMs,
    },
    broadcast: { contentType: row.broadcastContentType, body: row.broadcastBody },
  };
}

/**
 * Guarded on `status = 'pending'` so a duplicate/redelivered BullMQ job
 * can't push an already in-flight Delivery back to `in_progress`.
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
  return rows.length > 0;
}

/**
 * Records the Attempt and terminal Delivery status in one transaction. This
 * slice only ever writes Attempt `n = 1` (ADR 0003's retry loop is a later
 * ticket) — `failed` here covers every non-2xx outcome, network error, and
 * timeout alike.
 */
export async function completeDelivery(
  db: Database,
  input: {
    deliveryId: string;
    n: number;
    statusCode: number | null;
    durationMs: number;
    error: string | null;
    status: Extract<DeliveryStatus, "succeeded" | "failed">;
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
