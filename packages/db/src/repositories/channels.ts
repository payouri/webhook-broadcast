import { and, asc, eq, gt, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Database } from "../client.js";
import { isCheckViolation, isUniqueViolation } from "../pgErrors.js";
import { qualified } from "../qualifiedColumn.js";
import {
  channels,
  channelTokens,
  deliveries,
  endpoints,
  MIN_OPEN_INGEST_SLUG_LENGTH,
} from "../schema.js";
import { CHANNEL_RECENT_FAILURE_WINDOW_MS } from "./deliveries.js";

/** Must match the constraint name given to `check(...)` in `../schema.ts`. */
const OPEN_INGEST_SLUG_LENGTH_CHECK = "channel_open_ingest_slug_length_chk";

function isOpenIngestSlugCheckViolation(error: unknown): boolean {
  return isCheckViolation(error, OPEN_INGEST_SLUG_LENGTH_CHECK);
}

export interface ChannelRow {
  id: string;
  slug: string;
  description: string | null;
  enabled: boolean;
  forwardHeaders: string[];
  allowUnauthenticatedIngest: boolean;
  ingestSuccessStatus: number | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChannelTokenSummaryRow {
  id: string;
  prefix: string;
  createdAt: Date;
}

export class ChannelSlugConflictError extends Error {
  constructor(readonly slug: string) {
    super(`slug "${slug}" is already in use`);
    this.name = "ChannelSlugConflictError";
  }
}

/**
 * The check is on the resulting row, so a PATCH that only flips the flag
 * violates it without naming a slug — `slug` is undefined there rather than
 * an empty string, so the message never claims a slug the caller never sent.
 */
export class OpenIngestSlugTooShortError extends Error {
  constructor(readonly slug: string | undefined) {
    super(
      slug === undefined
        ? `this Channel's slug is too short for unauthenticated ingest (minimum ${MIN_OPEN_INGEST_SLUG_LENGTH} characters)`
        : `slug "${slug}" is too short for an unauthenticated-ingest Channel (minimum ${MIN_OPEN_INGEST_SLUG_LENGTH} characters)`,
    );
    this.name = "OpenIngestSlugTooShortError";
  }
}

export async function insertChannel(
  db: Database,
  input: {
    id: string;
    slug: string;
    description: string | null;
    enabled: boolean;
    forwardHeaders?: string[] | undefined;
    allowUnauthenticatedIngest: boolean;
    ingestSuccessStatus?: number | null | undefined;
    createdAt: Date;
    updatedAt: Date;
  },
): Promise<ChannelRow> {
  try {
    const [row] = await db
      .insert(channels)
      .values({ ...input, forwardHeaders: input.forwardHeaders ?? [] })
      .returning();
    if (!row) {
      throw new Error("insert returned no row");
    }
    return row;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ChannelSlugConflictError(input.slug);
    }
    if (isOpenIngestSlugCheckViolation(error)) {
      throw new OpenIngestSlugTooShortError(input.slug);
    }
    throw error;
  }
}

export async function getChannelById(db: Database, id: string): Promise<ChannelRow | undefined> {
  const [row] = await db
    .select()
    .from(channels)
    .where(and(eq(channels.id, id), isNull(channels.deletedAt)));
  return row;
}

/**
 * Ingest-only lookup: a disabled or soft-deleted Channel must reject the same
 * way as an unknown slug (issue #17 AC), so this folds both checks into one
 * query instead of leaking "exists but disabled" as a distinct outcome.
 */
export async function getActiveChannelBySlug(
  db: Database,
  slug: string,
): Promise<ChannelRow | undefined> {
  const [row] = await db
    .select()
    .from(channels)
    .where(and(eq(channels.slug, slug), eq(channels.enabled, true), isNull(channels.deletedAt)));
  return row;
}

/**
 * Issue #45: the Channel directory's health-first ordering key, in a single
 * tuple alongside the existing `(slug, id)` tie-break — a disabled Channel
 * is its own tier (2) regardless of any failure history, per the AC that
 * disabled is a choice and must never sort or read like a broken one, which
 * always ranks tier 0 ahead of an ordinary healthy Channel (tier 1).
 *
 * Issue #66: unhealthy Channels are now ranked by severity: within tier 0
 * (needs attention), a higher recent failure count sorts ahead of a lower one,
 * so the worst Channel lands at the top of an operator's glance. The tie-break
 * between failure count and auto-disabled Endpoint count is deliberate:
 * failure count takes priority (how acutely the Channel is failing), then
 * auto-disabled count (how many Endpoints are out of service), then slug and id
 * for deterministic pagination.
 *
 * Every leg is validated on decode, including the two #66 added. A cursor minted
 * before #66 carries only `(healthRank, slug, id)`, and tolerating that shape
 * would feed `undefined` into the keyset `WHERE` as a bound parameter, which the
 * driver refuses — verified: the request 500s. Validating here turns a stale
 * cursor from a server error into the 400 the contract already defines for an
 * unreadable one, which is what a client mid-pagination across a deploy gets.
 */
export interface ChannelCursor {
  healthRank: number;
  recentFailureCount: number;
  autoDisabledEndpointCount: number;
  slug: string;
  id: string;
}

export function encodeChannelCursor(cursor: ChannelCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeChannelCursor(cursor: string): ChannelCursor | undefined {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "healthRank" in parsed &&
      "recentFailureCount" in parsed &&
      "autoDisabledEndpointCount" in parsed &&
      "slug" in parsed &&
      "id" in parsed &&
      typeof (parsed as { healthRank: unknown }).healthRank === "number" &&
      typeof (parsed as { recentFailureCount: unknown }).recentFailureCount === "number" &&
      typeof (parsed as { autoDisabledEndpointCount: unknown }).autoDisabledEndpointCount ===
        "number" &&
      typeof (parsed as { slug: unknown }).slug === "string" &&
      typeof (parsed as { id: unknown }).id === "string"
    ) {
      return parsed as ChannelCursor;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Issue #45: 0 = needs attention (enabled, and either an Endpoint is
 * currently auto-disabled or it has a `failed`/`dead_lettered` Delivery
 * inside `CHANNEL_RECENT_FAILURE_WINDOW_MS`), 1 = healthy or quiet, 2 =
 * disabled. Disabled is checked first and short-circuits the rest — a
 * disabled Channel carrying stale failures still ranks tier 2, never tier 0,
 * because the AC treats "disabled" (a choice) and "broken" (not a choice) as
 * mutually exclusive outcomes. Built once and reused verbatim in both the
 * `WHERE` cursor comparison and the `ORDER BY` so the two can never disagree
 * about a given Channel's rank.
 */
function channelHealthRankSql(since: Date): SQL<number> {
  return sql<number>`
    case
      when not ${qualified(channels.enabled)} then 2
      when exists (
        select 1 from ${endpoints}
        where ${qualified(endpoints.channelId)} = ${qualified(channels.id)}
          and ${qualified(endpoints.autoDisabledAt)} is not null
      ) or exists (
        select 1 from ${deliveries}
        where ${qualified(deliveries.channelId)} = ${qualified(channels.id)}
          and ${qualified(deliveries.status)} in ('failed', 'dead_lettered')
          and ${qualified(deliveries.updatedAt)} >= ${since}
      ) then 0
      else 1
    end
  `;
}

export async function listChannels(
  db: Database,
  options: {
    cursor?: ChannelCursor | undefined;
    limit: number;
    slug?: string | undefined;
    now: Date;
  },
): Promise<{ items: ChannelRow[]; nextCursor: ChannelCursor | null }> {
  const { cursor, limit, slug, now } = options;
  const since = new Date(now.getTime() - CHANNEL_RECENT_FAILURE_WINDOW_MS);
  const healthRank = channelHealthRankSql(since);

  // Issue #66's severity legs, built once and reused verbatim in the `SELECT`,
  // the keyset `WHERE` and the `ORDER BY` — the same discipline `healthRank`
  // follows, so the value a cursor carries forward can never disagree with the
  // ordering that produced it. Both count over exactly the predicates
  // `channelHealthRankSql` tests for tier 0, so a Channel that ranks "needs
  // attention" always has a non-zero count on at least one of them.
  const recentFailureCountSubquery = sql<number>`
    coalesce(
      (select count(*)::integer
       from ${deliveries}
       where ${qualified(deliveries.channelId)} = ${qualified(channels.id)}
         and ${qualified(deliveries.status)} in ('failed', 'dead_lettered')
         and ${qualified(deliveries.updatedAt)} >= ${since}),
      0
    )
  `;

  const autoDisabledCountSubquery = sql<number>`
    coalesce(
      (select count(*)::integer
       from ${endpoints}
       where ${qualified(endpoints.channelId)} = ${qualified(channels.id)}
         and ${qualified(endpoints.autoDisabledAt)} is not null),
      0
    )
  `;

  const rows = await db
    .select({
      id: channels.id,
      slug: channels.slug,
      description: channels.description,
      enabled: channels.enabled,
      forwardHeaders: channels.forwardHeaders,
      allowUnauthenticatedIngest: channels.allowUnauthenticatedIngest,
      ingestSuccessStatus: channels.ingestSuccessStatus,
      deletedAt: channels.deletedAt,
      createdAt: channels.createdAt,
      updatedAt: channels.updatedAt,
      // Mapped explicitly because these values round-trip through the opaque
      // cursor as JSON: `decodeChannelCursor` rejects values that are not
      // `number`, so a driver handing back a string would break pagination
      // rather than merely mistyping a field.
      healthRank: healthRank.mapWith(Number),
      recentFailureCount: recentFailureCountSubquery.mapWith(Number),
      autoDisabledEndpointCount: autoDisabledCountSubquery.mapWith(Number),
    })
    .from(channels)
    .where(
      and(
        isNull(channels.deletedAt),
        slug !== undefined ? eq(channels.slug, slug) : undefined,
        cursor
          ? or(
              sql`${healthRank} > ${cursor.healthRank}`,
              and(
                sql`${healthRank} = ${cursor.healthRank}`,
                or(
                  sql`${recentFailureCountSubquery} < ${cursor.recentFailureCount}`,
                  and(
                    sql`${recentFailureCountSubquery} = ${cursor.recentFailureCount}`,
                    or(
                      sql`${autoDisabledCountSubquery} < ${cursor.autoDisabledEndpointCount}`,
                      and(
                        sql`${autoDisabledCountSubquery} = ${cursor.autoDisabledEndpointCount}`,
                        or(
                          gt(channels.slug, cursor.slug),
                          and(eq(channels.slug, cursor.slug), gt(channels.id, cursor.id)),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(
      sql`${healthRank} asc`,
      sql`${recentFailureCountSubquery} desc`,
      sql`${autoDisabledCountSubquery} desc`,
      asc(channels.slug),
      asc(channels.id),
    )
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const items: ChannelRow[] = page.map(
    ({
      healthRank: _healthRank,
      recentFailureCount: _rfc,
      autoDisabledEndpointCount: _adec,
      ...row
    }) => row,
  );
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? {
          healthRank: last.healthRank,
          recentFailureCount: last.recentFailureCount,
          autoDisabledEndpointCount: last.autoDisabledEndpointCount,
          slug: last.slug,
          id: last.id,
        }
      : null;
  return { items, nextCursor };
}

export async function updateChannel(
  db: Database,
  id: string,
  patch: {
    slug?: string | undefined;
    description?: string | null | undefined;
    enabled?: boolean | undefined;
    forwardHeaders?: string[] | undefined;
    allowUnauthenticatedIngest?: boolean | undefined;
    ingestSuccessStatus?: number | null | undefined;
    updatedAt: Date;
  },
): Promise<ChannelRow | undefined> {
  try {
    const [row] = await db
      .update(channels)
      .set(patch)
      .where(and(eq(channels.id, id), isNull(channels.deletedAt)))
      .returning();
    return row;
  } catch (error) {
    if (isUniqueViolation(error) && patch.slug !== undefined) {
      throw new ChannelSlugConflictError(patch.slug);
    }
    if (isOpenIngestSlugCheckViolation(error)) {
      throw new OpenIngestSlugTooShortError(patch.slug);
    }
    throw error;
  }
}

export async function softDeleteChannel(
  db: Database,
  id: string,
  deletedAt: Date,
): Promise<boolean> {
  const rows = await db
    .update(channels)
    .set({ deletedAt, updatedAt: deletedAt })
    .where(and(eq(channels.id, id), isNull(channels.deletedAt)))
    .returning({ id: channels.id });
  return rows.length > 0;
}

export async function getEndpointCountsByChannelIds(
  db: Database,
  channelIds: string[],
): Promise<Map<string, number>> {
  if (channelIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ channelId: endpoints.channelId, count: sql<number>`count(*)`.mapWith(Number) })
    .from(endpoints)
    .where(inArray(endpoints.channelId, channelIds))
    .groupBy(endpoints.channelId);
  return new Map(rows.map((row) => [row.channelId, row.count]));
}

export async function getTokenSummariesByChannelIds(
  db: Database,
  channelIds: string[],
): Promise<Map<string, ChannelTokenSummaryRow[]>> {
  if (channelIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      channelId: channelTokens.channelId,
      id: channelTokens.id,
      prefix: channelTokens.prefix,
      createdAt: channelTokens.createdAt,
    })
    .from(channelTokens)
    .where(inArray(channelTokens.channelId, channelIds));
  const byChannel = new Map<string, ChannelTokenSummaryRow[]>();
  for (const row of rows) {
    const list = byChannel.get(row.channelId) ?? [];
    list.push({ id: row.id, prefix: row.prefix, createdAt: row.createdAt });
    byChannel.set(row.channelId, list);
  }
  return byChannel;
}
