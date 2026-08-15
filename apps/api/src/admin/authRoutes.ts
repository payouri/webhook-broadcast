import type Router from "@koa/router";
import { errorBody, loginRequestSchema } from "@webhook-broadcast/contract";
import { safeEqual } from "./auth.js";
import { LoginRateLimiter } from "./loginRateLimit.js";

export interface AuthRouteConfig {
  operatorApiKey: string;
  cookieName: string;
  cookieSecure: boolean;
  trustProxy: boolean;
  loginRateLimitMaxAttempts: number;
  loginRateLimitWindowMs: number;
}

/**
 * Dashboard-only login/logout; not part of the published admin OpenAPI
 * contract (ADR 0005 only settles the accepted credential shapes, not this
 * endpoint's path). Login trades the operator API key for the same value
 * carried in an HttpOnly cookie so the dashboard never stores it in JS.
 *
 * Deliberately checks only `config.operatorApiKey`, never `operator_token`
 * rows (issue #41): the bootstrap credential remains the dashboard's sole
 * login secret, and minted operator tokens stay bearer-only for the API.
 * That keeps a leaked/rotated operator token from also being a dashboard
 * session credential.
 */
export function registerAuthRoutes(router: Router, config: AuthRouteConfig): void {
  const loginRateLimiter = new LoginRateLimiter({
    maxAttempts: config.loginRateLimitMaxAttempts,
    windowMs: config.loginRateLimitWindowMs,
  });

  router.post("/auth/login", async (ctx) => {
    const rateLimit = loginRateLimiter.tryConsume(ctx.ip);
    if (!rateLimit.allowed) {
      const retryAfterSeconds = Math.max(1, Math.ceil((rateLimit.resetAt - Date.now()) / 1000));
      ctx.status = 429;
      ctx.set("Retry-After", String(retryAfterSeconds));
      // `resetAt` rides alongside the standard envelope rather than joining
      // it (issue #91): this route is deliberately outside the published
      // admin OpenAPI contract already, and the dashboard needs the epoch to
      // drive a countdown, not another sentence to render verbatim.
      ctx.body = {
        ...errorBody("rate_limited", "Too many attempts. Try again once the cooldown ends."),
        resetAt: rateLimit.resetAt,
      };
      return;
    }

    const parsed = loginRequestSchema.safeParse(ctx.request.body);
    if (!parsed.success) {
      ctx.status = 400;
      ctx.body = errorBody("validation_failed", "invalid login payload");
      return;
    }

    if (!safeEqual(parsed.data.apiKey, config.operatorApiKey)) {
      ctx.status = 401;
      ctx.body = errorBody("unauthorized", "invalid operator API key");
      return;
    }

    ctx.cookies.set(config.cookieName, config.operatorApiKey, {
      httpOnly: true,
      sameSite: "lax",
      // Honor X-Forwarded-Proto only when explicitly configured; otherwise
      // derive Secure from boot config so a directly exposed API cannot be
      // tricked into issuing a session cookie over plain HTTP.
      secure: config.trustProxy ? ctx.secure : config.cookieSecure,
      path: "/",
    });
    ctx.status = 200;
    ctx.body = { ok: true };
  });

  router.post("/auth/logout", async (ctx) => {
    ctx.cookies.set(config.cookieName, "", { maxAge: 0, path: "/" });
    ctx.status = 204;
  });
}
