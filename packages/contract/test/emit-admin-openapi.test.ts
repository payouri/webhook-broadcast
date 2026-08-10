import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { emitAdminOpenApiDocument } from "../src/admin/openapi.js";
import { parseAdminOpenApiYaml, toCanonicalAdminOpenApiYaml } from "../src/admin/yaml.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const committedSketchPath = resolve(repoRoot, "docs/contracts/admin.openapi.yaml");

describe("emitAdminOpenApiDocument", () => {
  it("emits OpenAPI 3.1 matching the committed admin sketch", () => {
    const emitted = emitAdminOpenApiDocument();
    const committed = readFileSync(committedSketchPath, "utf8");

    expect(toCanonicalAdminOpenApiYaml(emitted)).toBe(
      toCanonicalAdminOpenApiYaml(parseAdminOpenApiYaml(committed)),
    );
  });

  it("does not publish ingest routes", () => {
    const paths = emitAdminOpenApiDocument().paths as Record<string, unknown>;
    expect(Object.keys(paths).some((path) => path.includes("/ingest"))).toBe(false);
  });

  it("documents shipped Channel-scoped Broadcast detail and replay routes", () => {
    const paths = emitAdminOpenApiDocument().paths as Record<string, unknown>;
    expect(paths["/channels/{channelId}/broadcasts/{broadcastId}"]).toBeDefined();
    expect(paths["/channels/{channelId}/broadcasts/{broadcastId}/replay"]).toBeDefined();
    expect(paths["/broadcasts/{broadcastId}"]).toBeUndefined();
  });
});
