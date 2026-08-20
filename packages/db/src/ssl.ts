import type { PoolConfig } from "pg";

/**
 * Thrown when `DATABASE_CA_CERT` pins a CA but `DATABASE_URL` also
 * configures TLS. `pg` would silently discard the pinned CA in that case
 * (see `resolveDatabaseSsl`), so the combination is refused instead.
 */
export class ConflictingDatabaseSslConfigError extends Error {
  constructor(readonly urlSslParams: readonly string[]) {
    super(
      `DATABASE_CA_CERT is set, but DATABASE_URL also configures TLS ` +
        `(${urlSslParams.join(", ")}). pg re-parses the connection string after ` +
        `merging explicit config, so the URL would silently win and the pinned CA ` +
        `would be discarded. Remove the ssl* parameter(s) from DATABASE_URL, or ` +
        `unset DATABASE_CA_CERT and let the URL configure TLS on its own.`,
    );
    this.name = "ConflictingDatabaseSslConfigError";
  }
}

/**
 * `pg` (via `pg-connection-string`) currently treats `sslmode=prefer`,
 * `require`, and `verify-ca` in a `DATABASE_URL` as aliases for
 * `verify-full` — the client verifies the server's certificate chain
 * against Node's bundled trust store. Managed Postgres providers (RDS,
 * Cloud SQL, …) sign with their own root, which is not in that store, so
 * a URL of the form every provider hands out (`?sslmode=require`) fails
 * verification even though the operator only asked for encryption.
 * `pg-connection-string@3.0.0` (pg v9) flips this the other way: the same
 * modes will adopt libpq's weaker semantics (encrypt-only, no
 * verification) instead of quietly upgrading to `verify-full`.
 *
 * Rather than depend on that resolution (which changes meaning across a
 * major bump either direction), pin verification explicitly here:
 *
 * - `DATABASE_CA_CERT` unset: `ssl` is left for `DATABASE_URL` alone to
 *   decide. Document the two supported forms in `.env.example`/README —
 *   plain (no TLS) for local compose, or
 *   `?sslmode=require&uselibpqcompat=true` for encrypt-only against a
 *   managed provider whose CA you are not pinning.
 * - `DATABASE_CA_CERT` set: verification is pinned to that CA, and
 *   `DATABASE_URL` must carry no `ssl*` parameter at all. `pg`'s
 *   `ConnectionParameters` re-parses the connection string *after*
 *   merging in explicit config and lets whatever `ssl` value it finds
 *   there win, silently discarding the `ssl` object returned here — the
 *   very reinterpretation this function exists to end. So rather than
 *   documenting that trap and hoping, the combination throws.
 */
export function resolveDatabaseSsl(connectionString: string, caCert?: string): PoolConfig["ssl"] {
  if (!caCert) {
    return undefined;
  }
  const urlSslParams = sslParamsIn(connectionString);
  if (urlSslParams.length > 0) {
    throw new ConflictingDatabaseSslConfigError(urlSslParams);
  }
  // Secret stores commonly hand back a multi-line PEM with literal `\n`
  // escapes instead of real newlines (env vars can't hold raw newlines in
  // several of them); a real PEM never contains a backslash, so rewriting
  // them unconditionally leaves a literal-newline PEM untouched.
  return { ca: caCert.replace(/\\n/g, "\n"), rejectUnauthorized: true };
}

/**
 * Every `ssl`-prefixed query parameter `pg-connection-string` recognises
 * (`ssl`, `sslmode`, `sslcert`, `sslkey`, `sslrootcert`, `sslnegotiation`)
 * makes its `parse()` emit an `ssl` key, which is what clobbers ours — so
 * the prefix is matched rather than the list enumerated, and stays correct
 * as that list grows. An unparseable URL is left for `pg` to reject.
 */
function sslParamsIn(connectionString: string): string[] {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return [];
  }
  return [...new Set(url.searchParams.keys())].filter((key) => key.toLowerCase().startsWith("ssl"));
}
