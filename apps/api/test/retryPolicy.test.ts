import { describe, expect, it } from "vitest";
import {
  computeBackoffDelayMs,
  isRetryableOutcome,
  parseRetryAfterMs,
} from "../src/worker/retryPolicy.js";

describe("isRetryableOutcome (ADR 0003)", () => {
  it("retries a network/TLS/timeout outcome (no status code)", () => {
    expect(isRetryableOutcome({ statusCode: null })).toBe(true);
  });

  it.each([408, 429, 500, 502, 503, 599])("retries status %d", (statusCode) => {
    expect(isRetryableOutcome({ statusCode })).toBe(true);
  });

  it.each([400, 401, 403, 404, 409, 422])(
    "fails status %d immediately (non-retryable 4xx)",
    (statusCode) => {
      expect(isRetryableOutcome({ statusCode })).toBe(false);
    },
  );
});

describe("parseRetryAfterMs", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");

  it("returns undefined for a missing header", () => {
    expect(parseRetryAfterMs(null, now)).toBeUndefined();
    expect(parseRetryAfterMs(undefined, now)).toBeUndefined();
  });

  it("parses delay-seconds", () => {
    expect(parseRetryAfterMs("120", now)).toBe(120_000);
  });

  it("parses an HTTP-date relative to now", () => {
    expect(parseRetryAfterMs("Thu, 01 Jan 2026 00:01:00 GMT", now)).toBe(60_000);
  });

  it("floors a past HTTP-date at 0", () => {
    expect(parseRetryAfterMs("Wed, 31 Dec 2025 00:00:00 GMT", now)).toBe(0);
  });

  it("returns undefined for garbage", () => {
    expect(parseRetryAfterMs("not-a-value", now)).toBeUndefined();
  });
});

describe("computeBackoffDelayMs", () => {
  it("doubles the exponential delay per attempt before jitter/capping", () => {
    expect(
      computeBackoffDelayMs({ attemptNumber: 1, baseMs: 5_000, capMs: 3_600_000, random: () => 1 }),
    ).toBe(5_000);
    expect(
      computeBackoffDelayMs({ attemptNumber: 2, baseMs: 5_000, capMs: 3_600_000, random: () => 1 }),
    ).toBe(10_000);
    expect(
      computeBackoffDelayMs({ attemptNumber: 3, baseMs: 5_000, capMs: 3_600_000, random: () => 1 }),
    ).toBe(20_000);
  });

  it("caps the exponential delay at capMs", () => {
    expect(
      computeBackoffDelayMs({ attemptNumber: 20, baseMs: 5_000, capMs: 60_000, random: () => 1 }),
    ).toBe(60_000);
  });

  it("applies full jitter uniformly within [0, capped]", () => {
    expect(
      computeBackoffDelayMs({ attemptNumber: 1, baseMs: 5_000, capMs: 3_600_000, random: () => 0 }),
    ).toBe(0);
    expect(
      computeBackoffDelayMs({
        attemptNumber: 1,
        baseMs: 5_000,
        capMs: 3_600_000,
        random: () => 0.5,
      }),
    ).toBe(2_500);
  });

  it("honours an explicit Retry-After over the exponential computation", () => {
    expect(
      computeBackoffDelayMs({
        attemptNumber: 1,
        baseMs: 5_000,
        capMs: 3_600_000,
        retryAfterMs: 90_000,
        random: () => 1,
      }),
    ).toBe(90_000);
  });

  it("caps an honoured Retry-After at the backoff cap", () => {
    expect(
      computeBackoffDelayMs({
        attemptNumber: 1,
        baseMs: 5_000,
        capMs: 60_000,
        retryAfterMs: 3_600_000,
        random: () => 1,
      }),
    ).toBe(60_000);
  });
});
