import { and, asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import type { Database } from "../client.js";
import { channels, channelTokens, endpoints } from "../schema.js";

export interface ChannelRow {
  id: string;
  slug: string;
  description: string | null;
  enabled: boolean;
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

/** Postgres unique_violation SQLSTATE (https://www.postgresql.org/docs/current/errcodes-appendix.html). */
const UNIQUE_VIOLATION = "23505";

function pgErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  if ("code" in error && typeof error.code === "string") {
    return error.code;
  }
  // drizzle-orm wraps the driver error as `DrizzleQueryError` with the
  // original `pg` error (carrying the SQLSTATE `code`) on `.cause`.
  if ("cause" in error) {
    return pgErrorCode(error.cause);
  }
  return undefined;
}

function isUniqueViolation(error: unknown): boolean {
  return pgErrorCode(error) === UNIQUE_VIOLATION;
}

export async function insertChannel(
  db: Database,
  input: {
    id: string;
    slug: string;
    description: string | null;
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
  },
): Promise<ChannelRow> {
  try {
    const [row] = await db.insert(channels).values(input).returning();
    if (!row) {
      throw new Error("insert returned no row");
    }
    return row;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ChannelSlugConflictError(input.slug);
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

export interface ChannelCursor {
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
      "slug" in parsed &&
      "id" in parsed &&
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

export async function listChannels(
  db: Database,
  options: { cursor?: ChannelCursor | undefined; limit: number },
): Promise<{ items: ChannelRow[]; nextCursor: ChannelCursor | null }> {
  const { cursor, limit } = options;
  const rows = await db
    .select()
    .from(channels)
    .where(
      and(
        isNull(channels.deletedAt),
        cursor
          ? or(
              gt(channels.slug, cursor.slug),
              and(eq(channels.slug, cursor.slug), gt(channels.id, cursor.id)),
            )
          : undefined,
      ),
    )
    .orderBy(asc(channels.slug), asc(channels.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? { slug: last.slug, id: last.id } : null;
  return { items, nextCursor };
}

export async function updateChannel(
  db: Database,
  id: string,
  patch: {
    slug?: string | undefined;
    description?: string | null | undefined;
    enabled?: boolean | undefined;
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
