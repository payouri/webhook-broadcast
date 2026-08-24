/**
 * Fails when a key the running system boot-validates is missing from
 * `.env.example` or from ADR 0008's env-surface table.
 *
 * This is the mechanical half of a documentation guarantee both of those files
 * make in prose: `.env.example` calls itself the full env surface and points at
 * ADR 0008 as authoritative, and `envSchema`'s own comment says it mirrors that
 * table. Before this check existed, all three drifted independently — `NODE_ENV`
 * was read by the server and documented nowhere, and three boot-validated keys
 * were in `.env.example` but absent from the ADR.
 *
 * Only the two Zod schemas are the source of truth here. Variables read by
 * compose alone (host-side port mappings, the Postgres image seed) are not
 * boot-validated and so are not checked — they live in ADR 0008's second and
 * third tables by convention, not by enforcement.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// Relative rather than by package name: the root workspace deliberately takes
// no dependency on the workspace packages, so there is nothing for
// `@webhook-broadcast/contract` to resolve against from here.
import { envSchema, migrateEnvSchema } from "../packages/contract/src/env.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_EXAMPLE = resolve(repoRoot, ".env.example");
const ADR = resolve(repoRoot, "docs/adr/0008-process-topology-deploy.md");

/**
 * A key counts as present in `.env.example` whether it is set or commented out:
 * an optional secret such as `DATABASE_CA_CERT` is documented as `# KEY=` on
 * purpose, so requiring a live assignment would force every optional key to
 * carry a value.
 */
function declaredInEnvExample(source: string, key: string): boolean {
  return new RegExp(`^\\s*#?\\s*${key}=`, "m").test(source);
}

/** A row in one of ADR 0008's tables, i.e. `| \`KEY\` | … |`. */
function declaredInAdrTable(source: string, key: string): boolean {
  return new RegExp(`^\\|\\s*\`${key}\`\\s*\\|`, "m").test(source);
}

const envExample = readFileSync(ENV_EXAMPLE, "utf8");
const adr = readFileSync(ADR, "utf8");

const bootKeys = [
  ...new Set([...Object.keys(envSchema.shape), ...Object.keys(migrateEnvSchema.shape)]),
].sort();

const problems: string[] = [];
for (const key of bootKeys) {
  if (!declaredInEnvExample(envExample, key)) {
    problems.push(`${key} is boot-validated but missing from .env.example`);
  }
  if (!declaredInAdrTable(adr, key)) {
    problems.push(
      `${key} is boot-validated but missing from the env surface table in docs/adr/0008-process-topology-deploy.md`,
    );
  }
}

if (problems.length > 0) {
  console.error(
    `Env surface drift (${problems.length} problem${problems.length === 1 ? "" : "s"}):`,
  );
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  console.error(
    "\nAdd the key to both, or drop it from the boot schema. Compose-only variables belong in ADR 0008's non-boot-validated tables and are not checked here.",
  );
  process.exit(1);
}

console.log(`Env surface matches: ${bootKeys.length} boot-validated keys documented in both.`);
