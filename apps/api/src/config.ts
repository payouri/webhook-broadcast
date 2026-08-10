import {
  loadEnv,
  loadMigrateEnv,
  EnvValidationError,
  type Env,
  type MigrateEnv,
} from "@webhook-broadcast/contract/env";

/**
 * Fail-fast entrypoint: any command that boots (server, worker, migrate)
 * calls this instead of reading process.env directly, so misconfig is a
 * loud, immediate exit rather than a runtime surprise (ADR 0008).
 */
export function bootEnv(): Env {
  try {
    return loadEnv();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

export function bootMigrateEnv(): MigrateEnv {
  try {
    return loadMigrateEnv();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}
