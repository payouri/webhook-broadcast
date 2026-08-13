import { createHash, randomBytes } from "node:crypto";

const TOKEN_RANDOM_BYTES = 24;
const PREFIX_LENGTH = 12;

/**
 * Every opaque bearer secret this service mints has the same shape: the
 * plaintext (returned once by a mint endpoint, never persisted), the hash
 * that *is* persisted, and the wire-safe recognition slice.
 */
export interface MintedToken {
  token: string;
  tokenHash: string;
  prefix: string;
}

/**
 * The only form of a minted token ever written down — a DB read alone cannot
 * recover a working token. Kind-agnostic on purpose: Channel ingest tokens and
 * operator tokens are told apart by their wire prefix, not by their digest.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function mintToken(wirePrefix: string): MintedToken {
  const token = `${wirePrefix}${randomBytes(TOKEN_RANDOM_BYTES).toString("base64url")}`;
  return {
    token,
    tokenHash: hashToken(token),
    prefix: token.slice(0, PREFIX_LENGTH),
  };
}

/**
 * Ingest tokens are opaque bearer secrets minted for Channel senders
 * (ADR 0005): plaintext is returned once by the mint endpoint and never
 * persisted — only the hash is stored.
 */
export function mintChannelToken(): MintedToken {
  return mintToken("wbt_");
}

/**
 * Operator tokens (issue #41) follow the same shape as Channel ingest
 * tokens, but use a distinct wire prefix (`wbop_`) so a leaked value's kind
 * is recognizable without a DB lookup.
 */
export function mintOperatorToken(): MintedToken {
  return mintToken("wbop_");
}
