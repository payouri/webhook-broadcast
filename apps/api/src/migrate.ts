import { resolve } from "node:path";
import { runMigrations } from "@webhook-broadcast/db";
import { bootMigrateEnv } from "./config.js";
import { serializeErrorChain } from "./errorChain.js";

const env = bootMigrateEnv();

// Resolved from the process cwd, not this module's location, so it holds
// under both `tsx` (dev) and the tsdown-bundled dist build (Docker WORKDIR
// is the repo root in both cases).
const migrationsFolder = resolve(process.cwd(), "packages/db/migrations");

runMigrations(env.DATABASE_URL, migrationsFolder)
  .then(() => {
    console.log(JSON.stringify({ msg: "migrations applied" }));
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error(JSON.stringify({ msg: "migration failed", error: serializeErrorChain(error) }));
    process.exit(1);
  });
