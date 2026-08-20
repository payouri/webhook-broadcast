import type { RedisOptions } from "ioredis";

/**
 * ioredis (see `Redis.parseOptions`/`resolveTLSProfile` in `ioredis@6`) sets
 * `tls: true` purely off the `rediss://` scheme and then defers to Node's
 * `tls.connect` defaults, where `rejectUnauthorized` is `true` — the client
 * verifies the server's certificate chain against Node's bundled trust
 * store. Managed Redis providers sign with their own root, which generally
 * isn't in that store, so a `rediss://` URL that asks only for encryption
 * fails to connect. Identical failure mode to the Postgres case in #102
 * (`packages/db/src/ssl.ts`), except Redis has no `sslrootcert`-style query
 * param: `parseURL` flattens `searchParams` straight into options with no
 * CA-bearing key, and the only other hatch — `?tls=<profile>` — ships
 * exactly one profile (Redis Cloud), whose bundled CA expired 2023-09-29.
 *
 * So this resolves TLS in code instead, mirroring #102's decision for a
 * second datastore:
 *
 * - `redis://`: plaintext. `tls` is left `undefined` — nothing to encrypt.
 * - `rediss://`, no `REDIS_CA_CERT`: encrypt, but do not verify
 *   (`rejectUnauthorized: false`) — Node's default would otherwise verify
 *   against a trust store the provider's root isn't in.
 * - `rediss://`, `REDIS_CA_CERT` set: encrypt and verify against that CA.
 *
 * Every construction site (`worker.ts`'s metrics `Queue` and `Worker`,
 * `deliveryQueue.ts`'s `Queue` and `ping()`'s own client) must go through
 * this rather than passing `{ url: redisUrl }` alone and relying on
 * ioredis's scheme handling — that's what leaves `/ready` (backed by
 * `ping()`) able to report under different TLS settings than the real
 * connection path, the same defect shape as #103.
 */
export function resolveRedisTls(redisUrl: string, caCert?: string): Pick<RedisOptions, "tls"> {
  if (!redisUrl.trim().toLowerCase().startsWith("rediss://")) {
    return {};
  }
  if (!caCert) {
    return { tls: { rejectUnauthorized: false } };
  }
  // Secret stores commonly hand back a multi-line PEM with literal `\n`
  // escapes instead of real newlines (env vars can't hold raw newlines in
  // several of them); a real PEM never contains a backslash, so rewriting
  // them unconditionally leaves a literal-newline PEM untouched.
  return { tls: { ca: caCert.replace(/\\n/g, "\n"), rejectUnauthorized: true } };
}

/**
 * `resolveRedisTls` plus the `url` every construction site also needs —
 * the shape BullMQ's `connection` option and ioredis's own `RedisOptions`
 * both accept directly.
 */
export function resolveRedisConnectionOptions(
  redisUrl: string,
  caCert?: string,
): RedisOptions & { url: string } {
  return { url: redisUrl, ...resolveRedisTls(redisUrl, caCert) };
}
