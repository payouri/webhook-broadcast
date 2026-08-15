export interface LoginRateLimitConfig {
  maxAttempts: number;
  windowMs: number;
}

interface Window {
  count: number;
  resetAt: number;
}

export interface LoginRateLimitResult {
  allowed: boolean;
  /** Epoch ms when this IP's window resets and a fresh attempt count begins. */
  resetAt: number;
}

/**
 * Simple in-memory per-IP limiter for `/auth/login`. Resets windows lazily
 * and is sufficient for a single-process MVP deployment.
 */
export class LoginRateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(private readonly config: LoginRateLimitConfig) {}

  /**
   * Reports whether the attempt is allowed and, either way, the `resetAt`
   * the caller needs to tell the operator how long the cooldown lasts (issue
   * #91) — the limiter already tracked this internally, it just never left
   * the process before.
   */
  tryConsume(clientIp: string): LoginRateLimitResult {
    const now = Date.now();
    const existing = this.windows.get(clientIp);
    if (!existing || now >= existing.resetAt) {
      const resetAt = now + this.config.windowMs;
      this.windows.set(clientIp, { count: 1, resetAt });
      return { allowed: true, resetAt };
    }

    if (existing.count >= this.config.maxAttempts) {
      return { allowed: false, resetAt: existing.resetAt };
    }

    existing.count += 1;
    return { allowed: true, resetAt: existing.resetAt };
  }
}
