import { and, eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { channelTokens } from "../schema.js";

export interface ChannelTokenRow {
  id: string;
  channelId: string;
  tokenHash: string;
  prefix: string;
  createdAt: Date;
}

export async function insertChannelToken(
  db: Database,
  input: {
    id: string;
    channelId: string;
    tokenHash: string;
    prefix: string;
    createdAt: Date;
  },
): Promise<ChannelTokenRow> {
  const [row] = await db.insert(channelTokens).values(input).returning();
  if (!row) {
    throw new Error("insert returned no row");
  }
  return row;
}

/**
 * Revocation is a hard delete, not a flag — an ingest lookup that joins on
 * `(channel_id, token_hash)` (see `findChannelTokenByHash`) stops matching
 * the instant the row is gone, so "revoke stops ingest" needs no extra state.
 */
export async function revokeChannelToken(
  db: Database,
  channelId: string,
  tokenId: string,
): Promise<boolean> {
  const rows = await db
    .delete(channelTokens)
    .where(and(eq(channelTokens.id, tokenId), eq(channelTokens.channelId, channelId)))
    .returning({ id: channelTokens.id });
  return rows.length > 0;
}

export async function findChannelTokenByHash(
  db: Database,
  channelId: string,
  tokenHash: string,
): Promise<ChannelTokenRow | undefined> {
  const [row] = await db
    .select()
    .from(channelTokens)
    .where(and(eq(channelTokens.channelId, channelId), eq(channelTokens.tokenHash, tokenHash)));
  return row;
}
