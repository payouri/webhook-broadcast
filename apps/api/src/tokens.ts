import { createHash, randomBytes } from "node:crypto";

const TOKEN_RANDOM_BYTES = 24;
const PREFIX_LENGTH = 12;

export interface MintedChannelToken {
  token: string;
  tokenHash: string;
  prefix: string;
}

/**
 * Ingest tokens are opaque bearer secrets minted for Channel senders
 * (ADR 0005): plaintext is returned once by the mint endpoint and never
 * persisted — only the hash is stored, so a DB read alone cannot recover a
 * working token. `prefix` is the wire-safe recognition slice.
 */
export function mintChannelToken(): MintedChannelToken {
  const token = `wbt_${randomBytes(TOKEN_RANDOM_BYTES).toString("base64url")}`;
  return {
    token,
    tokenHash: hashChannelToken(token),
    prefix: token.slice(0, PREFIX_LENGTH),
  };
}

export function hashChannelToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
