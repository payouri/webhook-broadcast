import { resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, runMigrations, type Database } from "@webhook-broadcast/db";
import type { Pool } from "pg";

export interface TestDb {
  db: Database;
  pool: Pool;
  reset: () => Promise<void>;
  stop: () => Promise<void>;
}

/**
 * One real Postgres per test file (ADR 0006: Vitest + Testcontainers), not a
 * mock — Channel CRUD exercises real unique-constraint and soft-delete
 * behavior that a stub would have to reimplement anyway.
 */
export async function startTestDb(): Promise<TestDb> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    "postgres:17-alpine",
  ).start();
  const connectionString = container.getConnectionUri();

  // Mirrors apps/api/src/migrate.ts: resolved from cwd (repo root under the
  // shared root vitest config), not this module's location.
  const migrationsFolder = resolve(process.cwd(), "packages/db/migrations");
  await runMigrations(connectionString, migrationsFolder);

  const { db, pool } = createDb(connectionString);

  return {
    db,
    pool,
    reset: async () => {
      await pool.query(
        "TRUNCATE TABLE attempt, delivery, broadcast, channel_token, endpoint, channel RESTART IDENTITY CASCADE",
      );
    },
    stop: async () => {
      await pool.end();
      await container.stop();
    },
  };
}
