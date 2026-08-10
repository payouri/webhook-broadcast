import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { emitAdminOpenApiDocument } from "../src/admin/openapi.js";
import { toCanonicalAdminOpenApiYaml } from "../src/admin/yaml.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const sketchPath = resolve(repoRoot, "docs/contracts/admin.openapi.yaml");

const document = emitAdminOpenApiDocument();
writeFileSync(sketchPath, toCanonicalAdminOpenApiYaml(document), "utf8");
console.log(`Wrote ${sketchPath}`);
