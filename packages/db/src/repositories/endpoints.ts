import { and, asc, eq, gt, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { Database } from "../client.js";
import { isUniqueViolation } from "../pgErrors.js";
import { qualified } from "../qualifiedColumn.js";
import { attempts, deliveries, endpoints } from "../schema.js";
import { CHANNEL_RECENT_FAILURE_WINDOW_MS } from "./deliveries.js";

export interface EndpointRow {
  id: string;
  channelId: string;
  name: string | null;
  url: string;
  timeoutMs: number | null;
  headers: Record<string, string>;
  enabled: boolean;
  autoDisabledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EndpointHealthRow {
  successRate24h: number | null;
  p95Ms: number | null;
  lastSuccessAt: Date | null;
}

export class EndpointUrlConflictError extends Error {
  constructor(readonly url: string) {
    super(`url "${url}" is already in use on this channel`);
    this.name = "EndpointUrlConflictError";
  }
}

export async function insertEndpoint(
  db: Database,
  input: {
    id: string;
    channelId: string;
    name: string | null;
    url: string;
    timeoutMs: number | null;
    headers: Record<string, string>;
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
  },
): Promise<EndpointRow> {
  try {
    const [row] = await db.insert(endpoints).values(input).returning();
    if (!row) {
      throw new Error("insert returned no row");
    }
    return row;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new EndpointUrlConflictError(input.url);
    }
    throw error;
  }
}

export async function getEndpointById(
  db: Database,
  channelId: string,
  id: string,
): Promise<EndpointRow | undefined> {
  const [row] = await db
    .select()
    .from(endpoints)
    .where(and(eq(endpoints.channelId, channelId), eq(endpoints.id, id)));
  return row;
}

export interface EndpointCursor {
  url: string;
  id: string;
}

export function encodeEndpointCursor(cursor: EndpointCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeEndpointCursor(cursor: string): EndpointCursor | undefined {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "url" in parsed &&
      "id" in parsed &&
      typeof (parsed as { url: unknown }).url === "string" &&
      typeof (parsed as { id: unknown }).id === "string"
    ) {
      return parsed as EndpointCursor;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export async function listEndpoints(
  db: Database,
  channelId: string,
  options: { cursor?: EndpointCursor | undefined; limit: number; url?: string | undefined },
): Promise<{ items: EndpointRow[]; nextCursor: EndpointCursor | null }> {
  const { cursor, limit, url } = options;
  const rows = await db
    .select()
    .from(endpoints)
    .where(
      and(
        eq(endpoints.channelId, channelId),
        url !== undefined ? eq(endpoints.url, url) : undefined,
        cursor
          ? or(
              gt(endpoints.url, cursor.url),
              and(eq(endpoints.url, cursor.url), gt(endpoints.id, cursor.id)),
            )
          : undefined,
      ),
    )
    .orderBy(asc(endpoints.url), asc(endpoints.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? { url: last.url, id: last.id } : null;
  return { items, nextCursor };
}

/**
 * The fan-out snapshot at accept time (ADR: Broadcast "fan-out targets are
 * the Endpoints enabled on that Channel at accept time") — unpaginated,
 * since ingest needs every enabled Endpoint in one shot to build Deliveries.
 */
export async function listEnabledEndpointsByChannel(
  db: Database,
  channelId: string,
): Promise<EndpointRow[]> {
  return db
    .select()
    .from(endpoints)
    .where(
      and(
        eq(endpoints.channelId, channelId),
        eq(endpoints.enabled, true),
        isNull(endpoints.autoDisabledAt),
      ),
    );
}

/**
 * ADR 0003: after a terminal Delivery failure, disable the Endpoint when
 * consecutive failures (no intervening success) span at least
 * `autoDisableAfterMs`. Idempotent — already auto-disabled Endpoints are
 * left alone.
 */
export async function maybeAutoDisableEndpoint(
  db: Database,
  input: { endpointId: string; autoDisableAfterMs: number; now: Date },
): Promise<boolean> {
  const endpoint = await db
    .select({ enabled: endpoints.enabled, autoDisabledAt: endpoints.autoDisabledAt })
    .from(endpoints)
    .where(eq(endpoints.id, input.endpointId))
    .then((rows) => rows[0]);
  if (!endpoint || endpoint.autoDisabledAt !== null || !endpoint.enabled) {
    return false;
  }

  const [lastSuccess] = await db
    .select({
      at: sql<Date | null>`max(${deliveries.updatedAt})`.mapWith((value) =>
        value === null ? null : new Date(value as string | Date),
      ),
    })
    .from(deliveries)
    .where(and(eq(deliveries.endpointId, input.endpointId), eq(deliveries.status, "succeeded")));

  const [streak] = await db
    .select({
      start: sql<Date | null>`min(${deliveries.updatedAt})`.mapWith((value) =>
        value === null ? null : new Date(value as string | Date),
      ),
    })
    .from(deliveries)
    .where(
      and(
        eq(deliveries.endpointId, input.endpointId),
        inArray(deliveries.status, ["failed", "dead_lettered"]),
        lastSuccess?.at ? gt(deliveries.updatedAt, lastSuccess.at) : undefined,
      ),
    );

  if (!streak?.start) {
    return false;
  }

  const streakDurationMs = input.now.getTime() - streak.start.getTime();
  if (streakDurationMs < input.autoDisableAfterMs) {
    return false;
  }

  const rows = await db
    .update(endpoints)
    .set({ enabled: false, autoDisabledAt: input.now, updatedAt: input.now })
    .where(and(eq(endpoints.id, input.endpointId), isNull(endpoints.autoDisabledAt)))
    .returning({ id: endpoints.id });
  return rows.length > 0;
}

/**
 * Channel directory (issue #45): how many of a Channel's Endpoints are
 * *currently* auto-disabled (ADR 0003) — `autoDisabledAt IS NOT NULL`, which
 * `PATCH .../endpoints/:id` with `enabled: true` clears, so a re-enabled
 * Endpoint drops out immediately rather than staying counted forever. One
 * grouped query for every requested Channel, never one per Channel — same
 * shape as `getEndpointCountsByChannelIds`.
 */
export async function getAutoDisabledEndpointCountsByChannelIds(
  db: Database,
  channelIds: string[],
): Promise<Map<string, number>> {
  if (channelIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ channelId: endpoints.channelId, count: sql<number>`count(*)`.mapWith(Number) })
    .from(endpoints)
    .where(and(inArray(endpoints.channelId, channelIds), isNotNull(endpoints.autoDisabledAt)))
    .groupBy(endpoints.channelId);
  return new Map(rows.map((row) => [row.channelId, row.count]));
}

export interface EndpointFailureRollupRow {
  endpointId: string;
  endpointName: string | null;
  endpointUrl: string;
  failed: number;
  deadLettered: number;
  autoDisabledAt: Date | null;
  lastFailureAt: Date;
}

/**
 * Issue #84: the ranked failure roll-up behind the Channel Activity's
 * "group failures by Endpoint" view — one row per Endpoint of `channelId`
 * with at least one `failed`/`dead_lettered` Delivery inside
 * `CHANNEL_RECENT_FAILURE_WINDOW_MS`, the exact same window and predicate
 * `getRecentFailureCountsByChannelIds` uses for the Channel directory badge
 * (packages/db/src/repositories/deliveries.ts), so the badge's count and
 * this roll-up's `failed + deadLettered` sums can never disagree.
 *
 * Unpaginated (ADR 0001: an Endpoint belongs to exactly one Channel, so this
 * set is bounded by the Channel's own Endpoint count) — every failing
 * Endpoint comes back, and every count is complete.
 *
 * Ranked severity-first, computed in SQL and built once per leg so `SELECT`
 * and `ORDER BY` can never disagree about a given Endpoint's rank (the same
 * discipline as `channelHealthRankSql` in `channels.ts`):
 *
 *   1. auto-disabled first — an auto-disabled Endpoint has *stopped*
 *      delivering, so its counts stop growing and would otherwise sink
 *      beneath a noisier but still-live Endpoint while being the worst
 *      problem on the Channel. (Deliberately the opposite of
 *      `channelHealthRankSql`, where a *disabled Channel* — a choice — ranks
 *      last: an auto-disabled Endpoint is a failure outcome, not a choice.)
 *   2. `deadLettered` desc
 *   3. `failed` desc
 *   4. `lastFailureAt` desc
 *   5. name (falling back to url when unnamed), then id, for determinism.
 */
export async function getFailureRollupForChannel(
  db: Database,
  channelId: string,
  now: Date,
): Promise<EndpointFailureRollupRow[]> {
  const since = new Date(now.getTime() - CHANNEL_RECENT_FAILURE_WINDOW_MS);

  const autoDisabledRank = sql<number>`case when ${qualified(endpoints.autoDisabledAt)} is not null then 0 else 1 end`;
  const deadLetteredCount = sql<number>`count(*) filter (where ${qualified(deliveries.status)} = 'dead_lettered')`;
  const failedCount = sql<number>`count(*) filter (where ${qualified(deliveries.status)} = 'failed')`;
  const lastFailureAt = sql<Date>`max(${qualified(deliveries.updatedAt)})`;
  const nameOrUrl = sql`coalesce(${qualified(endpoints.name)}, ${qualified(endpoints.url)})`;

  const rows = await db
    .select({
      endpointId: endpoints.id,
      endpointName: endpoints.name,
      endpointUrl: endpoints.url,
      autoDisabledAt: endpoints.autoDisabledAt,
      deadLettered: deadLetteredCount.mapWith(Number),
      failed: failedCount.mapWith(Number),
      lastFailureAt: lastFailureAt.mapWith((value) => new Date(value as string | Date)),
    })
    .from(endpoints)
    .innerJoin(deliveries, eq(deliveries.endpointId, endpoints.id))
    .where(
      and(
        eq(endpoints.channelId, channelId),
        inArray(deliveries.status, ["failed", "dead_lettered"]),
        gte(deliveries.updatedAt, since),
      ),
    )
    .groupBy(endpoints.id)
    .orderBy(
      sql`${autoDisabledRank} asc`,
      sql`${deadLetteredCount} desc`,
      sql`${failedCount} desc`,
      sql`${lastFailureAt} desc`,
      sql`${nameOrUrl} asc`,
      asc(endpoints.id),
    );

  return rows;
}

/** Endpoint health aggregates for the admin list (ADR 0007 — computed in SQL). */
export async function getEndpointHealthByIds(
  db: Database,
  endpointIds: string[],
): Promise<Map<string, EndpointHealthRow>> {
  if (endpointIds.length === 0) {
    return new Map();
  }

  const since = sql`now() - interval '24 hours'`;

  const deliveryStats = await db
    .select({
      endpointId: deliveries.endpointId,
      successRate24h: sql<number | null>`
        count(*) filter (where ${deliveries.status} = 'succeeded')::float
        / nullif(
          count(*) filter (where ${deliveries.status} in ('succeeded', 'failed', 'dead_lettered')),
          0
        )
      `.mapWith((value) => (value === null ? null : Number(value))),
      lastSuccessAt:
        sql<Date | null>`max(${deliveries.updatedAt}) filter (where ${deliveries.status} = 'succeeded')`.mapWith(
          (value) => (value === null ? null : new Date(value as string | Date)),
        ),
    })
    .from(deliveries)
    .where(
      and(inArray(deliveries.endpointId, endpointIds), sql`${deliveries.updatedAt} >= ${since}`),
    )
    .groupBy(deliveries.endpointId);

  const attemptStats = await db
    .select({
      endpointId: deliveries.endpointId,
      p95Ms: sql<number | null>`
        percentile_cont(0.95) within group (order by ${attempts.durationMs})
      `.mapWith((value) => (value === null ? null : Math.round(Number(value)))),
    })
    .from(attempts)
    .innerJoin(deliveries, eq(deliveries.id, attempts.deliveryId))
    .where(
      and(
        inArray(deliveries.endpointId, endpointIds),
        sql`${attempts.at} >= ${since}`,
        sql`${attempts.durationMs} is not null`,
      ),
    )
    .groupBy(deliveries.endpointId);

  const p95ByEndpoint = new Map(attemptStats.map((row) => [row.endpointId, row.p95Ms]));

  return new Map(
    deliveryStats.map((row) => [
      row.endpointId,
      {
        successRate24h: row.successRate24h,
        p95Ms: p95ByEndpoint.get(row.endpointId) ?? null,
        lastSuccessAt: row.lastSuccessAt,
      },
    ]),
  );
}

/**
 * Hard delete (issue #36) — Endpoints have no soft-delete marker, so removing
 * one really frees its `(channelId, url)` uniqueness for reuse (e.g. an
 * ephemeral CI environment re-registering at the same hostname). Deliveries
 * and Attempts targeting this Endpoint cascade via `ON DELETE CASCADE`.
 */
export async function deleteEndpoint(
  db: Database,
  channelId: string,
  id: string,
): Promise<boolean> {
  const rows = await db
    .delete(endpoints)
    .where(and(eq(endpoints.channelId, channelId), eq(endpoints.id, id)))
    .returning({ id: endpoints.id });
  return rows.length > 0;
}

export async function updateEndpoint(
  db: Database,
  channelId: string,
  id: string,
  patch: {
    name?: string | null | undefined;
    url?: string | undefined;
    timeoutMs?: number | null | undefined;
    headers?: Record<string, string> | undefined;
    enabled?: boolean | undefined;
    autoDisabledAt?: Date | null | undefined;
    updatedAt: Date;
  },
): Promise<EndpointRow | undefined> {
  try {
    const [row] = await db
      .update(endpoints)
      .set(patch)
      .where(and(eq(endpoints.channelId, channelId), eq(endpoints.id, id)))
      .returning();
    return row;
  } catch (error) {
    if (isUniqueViolation(error) && patch.url !== undefined) {
      throw new EndpointUrlConflictError(patch.url);
    }
    throw error;
  }
}
