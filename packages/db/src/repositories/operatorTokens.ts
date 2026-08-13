import { desc, eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { operatorTokens } from "../schema.js";

export interface OperatorTokenRow {
  id: string;
  tokenHash: string;
  prefix: string;
  label: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export async function insertOperatorToken(
  db: Database,
  input: {
    id: string;
    tokenHash: string;
    prefix: string;
    label: string;
    createdAt: Date;
  },
): Promise<OperatorTokenRow> {
  const [row] = await db.insert(operatorTokens).values(input).returning();
  if (!row) {
    throw new Error("insert returned no row");
  }
  return row;
}

/**
 * Revocation is a hard delete, not a flag — mirrors `revokeChannelToken`:
 * once the row is gone, `findOperatorTokenByHash` stops matching it
 * immediately, so revoking a holder takes effect with no redeploy.
 */
export async function revokeOperatorToken(db: Database, tokenId: string): Promise<boolean> {
  const rows = await db
    .delete(operatorTokens)
    .where(eq(operatorTokens.id, tokenId))
    .returning({ id: operatorTokens.id });
  return rows.length > 0;
}

export async function findOperatorTokenByHash(
  db: Database,
  tokenHash: string,
): Promise<OperatorTokenRow | undefined> {
  const [row] = await db
    .select()
    .from(operatorTokens)
    .where(eq(operatorTokens.tokenHash, tokenHash));
  return row;
}

export async function listOperatorTokens(db: Database): Promise<OperatorTokenRow[]> {
  return db.select().from(operatorTokens).orderBy(desc(operatorTokens.createdAt));
}

/**
 * Best-effort recency marker for the admin token list — callers fire this
 * without awaiting the result on the request's hot path (see auth.ts).
 */
export async function touchOperatorTokenLastUsed(
  db: Database,
  tokenId: string,
  at: Date,
): Promise<void> {
  await db.update(operatorTokens).set({ lastUsedAt: at }).where(eq(operatorTokens.id, tokenId));
}
