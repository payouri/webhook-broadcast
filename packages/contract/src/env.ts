import { z } from "zod";
// Issue #99: this one default lives in `channel.js` rather than here because
// `apps/web` renders it (the per-Channel override's "inherit" placeholder) and
// must not import this module — `env.ts` is Node-only (`process`, `NodeJS`).
import { DEFAULT_INGEST_SUCCESS_STATUS } from "./channel.js";

/** Canonical defaults — keep env.ts Zod schema and runtime fallbacks in sync. */
export const DEFAULT_INGEST_MAX_BODY_BYTES = 1_048_576;
export const DEFAULT_DELIVERY_TIMEOUT_MS = 10_000;
export const DEFAULT_DELIVERY_MAX_ATTEMPTS = 8;
export const DEFAULT_DELIVERY_BACKOFF_MS = 5_000;
export const DEFAULT_DELIVERY_BACKOFF_MAX_MS = 3_600_000;
export const DEFAULT_ENDPOINT_AUTO_DISABLE_AFTER_MS = 3_600_000;

/**
 * Full process boot config for the `server` and `worker` commands.
 * Mirrors the env surface table in docs/adr/0008-process-topology-deploy.md,
 * and `.env.example` — `pnpm docs:check:env` fails CI when a key here is
 * missing from either, so this is enforced rather than asserted.
 */
export const envSchema = z.object({
  /**
   * Deployment mode. The only thing this service reads it for is whether the
   * operator session cookie is marked `Secure` — `production` means it is, so
   * a deployment that forgets to set it degrades to a cookie usable over
   * plain HTTP. Validated here rather than read off `process.env` at the call
   * site so it appears in the documented env surface like every other key.
   */
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  /**
   * Pins TLS verification of `DATABASE_URL`'s Postgres server to this CA
   * (PEM, `\n`-escaped or literal newlines both accepted) instead of
   * Node's bundled trust store — see `packages/db/src/ssl.ts` for why a
   * managed provider's own root needs pinning explicitly. Unset means
   * `DATABASE_URL` alone decides TLS (see `.env.example`); set, it is
   * mutually exclusive with any `ssl*` parameter in `DATABASE_URL`.
   */
  DATABASE_CA_CERT: z.string().optional(),
  REDIS_URL: z.url(),
  /**
   * Pins TLS verification of a `rediss://` `REDIS_URL` to this CA (PEM,
   * `\n`-escaped or literal newlines both accepted) instead of leaving
   * ioredis to defer to Node's `tls.connect` defaults — see
   * `apps/api/src/redisTls.ts` for why (ioredis parses no
   * `sslrootcert`-equivalent param, unlike `pg`). Unset means a `rediss://`
   * URL still encrypts but does not verify the server certificate;
   * `redis://` is unaffected either way. Not part of `migrateEnvSchema`:
   * `migrate` touches Postgres only.
   */
  REDIS_CA_CERT: z.string().optional(),
  OPERATOR_API_KEY: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(8080),
  WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(9091),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(10),
  INGEST_MAX_BODY_BYTES: z.coerce.number().int().positive().default(DEFAULT_INGEST_MAX_BODY_BYTES),
  INGEST_HEADER_ALLOWLIST: z.string().default(""),
  INGEST_HEADER_DENYLIST: z.string().default(""),
  /**
   * Issue #99: the status `POST /ingest/:slug` answers on the accepted
   * path. `202` is the correct REST answer and stays the default, but at
   * least one real-world producer treats anything other than `200` as a
   * failure and retries a request the broadcaster already accepted — which
   * turns every event into six Broadcasts, permanently. Constrained to 2xx:
   * a non-2xx "success" would break the retry logic of every *other*
   * producer pointed at the same deployment. Per-Channel overrides live on
   * `channel.ingestSuccessStatus`; this is the service-wide default they
   * inherit when unset.
   */
  INGEST_SUCCESS_STATUS: z.coerce
    .number()
    .int()
    .min(200)
    .max(299)
    .default(DEFAULT_INGEST_SUCCESS_STATUS),
  HISTORY_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  DELIVERY_TIMEOUT_MS: z.coerce.number().int().positive().default(DEFAULT_DELIVERY_TIMEOUT_MS),
  DELIVERY_MAX_ATTEMPTS: z.coerce.number().int().positive().default(DEFAULT_DELIVERY_MAX_ATTEMPTS),
  DELIVERY_BACKOFF_MS: z.coerce.number().int().positive().default(DEFAULT_DELIVERY_BACKOFF_MS),
  DELIVERY_BACKOFF_MAX_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_DELIVERY_BACKOFF_MAX_MS),
  ENDPOINT_AUTO_DISABLE_AFTER_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_ENDPOINT_AUTO_DISABLE_AFTER_MS),
  COOKIE_NAME: z.string().default("wb_operator"),
  TRUST_PROXY: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
});

export type Env = z.infer<typeof envSchema>;

/**
 * The `migrate` command only ever touches Postgres — validating the full
 * env surface there would make the migrate job fail-fast on unrelated
 * misconfig (e.g. a missing OPERATOR_API_KEY) that has nothing to do with
 * running migrations.
 */
export { DEFAULT_INGEST_SUCCESS_STATUS };

export const migrateEnvSchema = z.object({
  DATABASE_URL: z.url(),
  DATABASE_CA_CERT: z.string().optional(),
});

export type MigrateEnv = z.infer<typeof migrateEnvSchema>;

export class EnvValidationError extends Error {
  constructor(readonly cause: z.ZodError) {
    super(`Invalid environment configuration:\n${z.prettifyError(cause)}`);
    this.name = "EnvValidationError";
  }
}

function parseEnv<TSchema extends z.ZodType>(
  schema: TSchema,
  source: NodeJS.ProcessEnv,
): z.infer<TSchema> {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(result.error);
  }
  return result.data;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return parseEnv(envSchema, source);
}

export function loadMigrateEnv(source: NodeJS.ProcessEnv = process.env): MigrateEnv {
  return parseEnv(migrateEnvSchema, source);
}
