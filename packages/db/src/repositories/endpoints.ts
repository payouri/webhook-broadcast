import { and, asc, eq, gt, or } from "drizzle-orm";
import type { Database } from "../client.js";
import { endpoints } from "../schema.js";

export interface EndpointRow {
  id: string;
  channelId: string;
  name: string | null;
  url: string;
  timeoutMs: number | null;
  headers: Record<string, string>;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class EndpointUrlConflictError extends Error {
  constructor(readonly url: string) {
    super(`url "${url}" is already in use on this channel`);
    this.name = "EndpointUrlConflictError";
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
  options: { cursor?: EndpointCursor | undefined; limit: number },
): Promise<{ items: EndpointRow[]; nextCursor: EndpointCursor | null }> {
  const { cursor, limit } = options;
  const rows = await db
    .select()
    .from(endpoints)
    .where(
      and(
        eq(endpoints.channelId, channelId),
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
