import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { emitAdminOpenApiDocument } from "../src/admin/openapi.js";
import { parseAdminOpenApiYaml, toCanonicalAdminOpenApiYaml } from "../src/admin/yaml.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const ADMIN_OPENAPI_SKETCH_PATH = resolve(repoRoot, "docs/contracts/admin.openapi.yaml");

export interface DriftCheckOptions {
  committedYaml?: string;
}

export function checkAdminOpenApiDrift(
  options: DriftCheckOptions = {},
): { ok: true } | { ok: false; message: string } {
  const committed = options.committedYaml ?? readFileSync(ADMIN_OPENAPI_SKETCH_PATH, "utf8");
  const emitted = toCanonicalAdminOpenApiYaml(emitAdminOpenApiDocument());
  const normalizedCommitted = toCanonicalAdminOpenApiYaml(parseAdminOpenApiYaml(committed));

  if (emitted === normalizedCommitted) {
    return { ok: true };
  }

  return {
    ok: false,
    message:
      "Admin OpenAPI drift detected: Zod emission differs from docs/contracts/admin.openapi.yaml. Run `pnpm contract:emit`.",
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = checkAdminOpenApiDrift();
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  console.log("Admin OpenAPI sketch matches Zod emission.");
}
