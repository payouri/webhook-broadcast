import type Router from "@koa/router";
import { errorBody, loginRequestSchema } from "@webhook-broadcast/contract";
import { safeEqual } from "./auth.js";

export interface AuthRouteConfig {
  operatorApiKey: string;
  cookieName: string;
}

/**
 * Dashboard-only login/logout; not part of the published admin OpenAPI
 * contract (ADR 0005 only settles the accepted credential shapes, not this
 * endpoint's path). Login trades the operator API key for the same value
 * carried in an HttpOnly cookie so the dashboard never stores it in JS.
 */
export function registerAuthRoutes(router: Router, config: AuthRouteConfig): void {
  router.post("/auth/login", async (ctx) => {
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
      // `ctx.secure` (with `app.proxy = true`) reflects `X-Forwarded-Proto`
      // behind a TLS-terminating reverse proxy — a static "are we in prod"
      // flag would either reject plain-HTTP compose deployments or send an
      // insecure cookie behind TLS.
      secure: ctx.secure,
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
