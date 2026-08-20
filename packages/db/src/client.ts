import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { resolveDatabaseSsl } from "./ssl.js";
import * as schema from "./schema.js";

export type Database = NodePgDatabase<typeof schema>;

/**
 * One Pool per process — the API and worker are separate processes
 * (docs/adr/0008-process-topology-deploy.md) and must not share a Pool.
 *
 * `caCert` pins TLS verification explicitly instead of letting `pg`
 * derive it from `connectionString` alone — see `resolveDatabaseSsl`.
 */
export function createDb(connectionString: string, caCert?: string): { db: Database; pool: Pool } {
  const pool = new Pool({ connectionString, ssl: resolveDatabaseSsl(connectionString, caCert) });
  const db = drizzle({ client: pool, schema });
  return { db, pool };
}
