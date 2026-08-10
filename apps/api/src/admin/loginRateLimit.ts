export interface LoginRateLimitConfig {
  maxAttempts: number;
  windowMs: number;
}

interface Window {
  count: number;
  resetAt: number;
}

/**
 * Simple in-memory per-IP limiter for `/auth/login`. Resets windows lazily
 * and is sufficient for a single-process MVP deployment.
 */
export class LoginRateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(private readonly config: LoginRateLimitConfig) {}

  /** Returns true when the attempt is allowed, false when rate-limited. */
  tryConsume(clientIp: string): boolean {
    const now = Date.now();
    const existing = this.windows.get(clientIp);
    if (!existing || now >= existing.resetAt) {
      this.windows.set(clientIp, {
        count: 1,
        resetAt: now + this.config.windowMs,
      });
      return true;
    }

    if (existing.count >= this.config.maxAttempts) {
      return false;
    }

    existing.count += 1;
    return true;
  }
}
