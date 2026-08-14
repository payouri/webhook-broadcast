import { describe, expect, it } from "vitest";
import { ApiRequestError, describeApiError, formatApiErrorMessage } from "../src/lib/api.js";

describe("describeApiError", () => {
  it("renders Zod field detail verbatim, unchanged from today's behaviour", () => {
    const message = formatApiErrorMessage(
      "invalid payload",
      [{ path: "slug", message: "slug must be at least 3 characters" }],
      "fallback",
    );
    const err = new ApiRequestError(400, "validation_failed", message, [
      { path: "slug", message: "slug must be at least 3 characters" },
    ]);

    expect(describeApiError(err, "Failed to save Endpoint")).toBe(
      "slug must be at least 3 characters",
    );
  });

  it("renders a deliberately authored domain message (e.g. a conflict) verbatim", () => {
    const err = new ApiRequestError(409, "conflict", "slug already exists");

    expect(describeApiError(err, "Failed to save Channel")).toBe("slug already exists");
  });

  it("describes an internal_error in the caller's terms, naming the status", () => {
    const err = new ApiRequestError(500, "internal_error", "internal server error");

    expect(describeApiError(err, "Failed to load more Activity")).toBe(
      "Failed to load more Activity (HTTP 500)",
    );
  });

  it("describes a response whose body didn't parse as the error envelope", () => {
    // Mirrors throwApiError's `code: "unknown"` default and a `statusText`-only message.
    const err = new ApiRequestError(502, "unknown", "Bad Gateway");

    expect(describeApiError(err, "Failed to retry Delivery")).toBe(
      "Failed to retry Delivery (HTTP 502)",
    );
  });

  it("describes an off-contract code rather than echoing a gateway's own envelope", () => {
    // A code the contract never defines: it lands on the safe side of the
    // allowlist, so the gateway's wording never reaches the operator.
    const err = new ApiRequestError(504, "upstream_timeout", "upstream timed out");

    expect(describeApiError(err, "Failed to save settings")).toBe(
      "Failed to save settings (HTTP 504)",
    );
  });

  it("falls back with no status for a network failure that never reached the server", () => {
    const err = new TypeError("Failed to fetch");

    expect(describeApiError(err, "Login failed")).toBe("Login failed");
  });
});
