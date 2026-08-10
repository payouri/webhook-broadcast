import { z } from "zod";

/**
 * Full process boot config for the `server` and `worker` commands.
 * Mirrors the env surface table in docs/adr/0008-process-topology-deploy.md.
 */
export const envSchema = z.object({
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  OPERATOR_API_KEY: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(8080),
  WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(9091),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(10),
  INGEST_MAX_BODY_BYTES: z.coerce.number().int().positive().default(1_048_576),
  INGEST_HEADER_ALLOWLIST: z.string().default(""),
  INGEST_HEADER_DENYLIST: z.string().default(""),
  HISTORY_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  DELIVERY_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  DELIVERY_MAX_ATTEMPTS: z.coerce.number().int().positive().default(8),
  DELIVERY_BACKOFF_MS: z.coerce.number().int().positive().default(5_000),
  DELIVERY_BACKOFF_MAX_MS: z.coerce.number().int().positive().default(3_600_000),
  ENDPOINT_AUTO_DISABLE_AFTER_MS: z.coerce.number().int().positive().default(3_600_000),
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
export const migrateEnvSchema = z.object({
  DATABASE_URL: z.url(),
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
