import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

/**
 * `migrationsFolder` is caller-supplied rather than derived from
 * `import.meta.url` — after this module is bundled by tsdown for
 * production, the bundle's own file location no longer matches the
 * source tree, so a self-relative path would silently point at the
 * wrong directory. Callers resolve it relative to a stable process cwd
 * instead (see apps/api/src/migrate.ts).
 */
export async function runMigrations(
  connectionString: string,
  migrationsFolder: string,
): Promise<void> {
  const pool = new Pool({ connectionString });
  try {
    const db = drizzle({ client: pool });
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}
