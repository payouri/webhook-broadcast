import { describe, expect, it } from "vitest";
import { envSchema } from "../src/env.js";

/**
 * The boot-validated env surface. `DOCS_ENABLED` (issue #107) is a strict
 * `"true"`/`"false"` enum rather than loose truthy coercion precisely so a
 * typo in deploy config fails at boot; that guarantee is only worth as much
 * as a test that shows the typo actually failing.
 */
const REQUIRED = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  OPERATOR_API_KEY: "operator-key",
};

describe("DOCS_ENABLED", () => {
  it("defaults on when the variable is absent", () => {
    expect(envSchema.parse({ ...REQUIRED }).DOCS_ENABLED).toBe(true);
  });

  it.each([
    ["true", true],
    ["false", false],
  ])("parses %s as the boolean %s", (raw, expected) => {
    expect(envSchema.parse({ ...REQUIRED, DOCS_ENABLED: raw }).DOCS_ENABLED).toBe(expected);
  });

  it.each(["1", "0", "TRUE", "yes", "", "off"])(
    "fails validation on %o rather than silently defaulting",
    (raw) => {
      expect(() => envSchema.parse({ ...REQUIRED, DOCS_ENABLED: raw })).toThrow();
    },
  );
});
