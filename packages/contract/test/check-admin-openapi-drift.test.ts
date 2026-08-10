import { describe, expect, it } from "vitest";
import { checkAdminOpenApiDrift } from "../scripts/check-admin-openapi-drift.js";

describe("checkAdminOpenApiDrift", () => {
  it("passes when emitted admin OpenAPI matches the committed sketch", () => {
    expect(checkAdminOpenApiDrift()).toEqual({ ok: true as const });
  });

  it("fails when the sketch drifts from Zod emission", () => {
    const result = checkAdminOpenApiDrift({
      committedYaml: "openapi: 3.1.0\ninfo:\n  title: drift\n  version: 0.0.0\npaths: {}\n",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("drift");
    }
  });
});
