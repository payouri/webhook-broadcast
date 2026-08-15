import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginRateLimiter } from "../src/admin/loginRateLimit.js";

describe("LoginRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows attempts up to the configured max, then reports resetAt on every subsequent call (issue #91)", () => {
    const limiter = new LoginRateLimiter({ maxAttempts: 5, windowMs: 60_000 });
    const clientIp = "203.0.113.1";

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(limiter.tryConsume(clientIp).allowed).toBe(true);
    }

    const blocked = limiter.tryConsume(clientIp);
    expect(blocked.allowed).toBe(false);
    expect(blocked.resetAt).toBe(Date.now() + 60_000);

    // Still blocked, and resetAt is stable across repeated attempts within
    // the same window rather than sliding forward on each try — a live
    // countdown reading it needs a fixed target.
    const stillBlocked = limiter.tryConsume(clientIp);
    expect(stillBlocked.allowed).toBe(false);
    expect(stillBlocked.resetAt).toBe(blocked.resetAt);
  });

  it("allows a fresh attempt once the window has elapsed", () => {
    const limiter = new LoginRateLimiter({ maxAttempts: 1, windowMs: 60_000 });
    const clientIp = "203.0.113.2";

    expect(limiter.tryConsume(clientIp).allowed).toBe(true);
    expect(limiter.tryConsume(clientIp).allowed).toBe(false);

    vi.advanceTimersByTime(60_001);

    expect(limiter.tryConsume(clientIp).allowed).toBe(true);
  });

  it("tracks each client IP independently", () => {
    const limiter = new LoginRateLimiter({ maxAttempts: 1, windowMs: 60_000 });

    expect(limiter.tryConsume("203.0.113.3").allowed).toBe(true);
    expect(limiter.tryConsume("203.0.113.3").allowed).toBe(false);
    expect(limiter.tryConsume("203.0.113.4").allowed).toBe(true);
  });
});
