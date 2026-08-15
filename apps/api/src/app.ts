import Koa from "koa";
import Router from "@koa/router";
import { bodyParser } from "@koa/bodyparser";
import { errorBody, healthResponseSchema, readyResponseSchema } from "@webhook-broadcast/contract";
import { DEFAULT_INGEST_MAX_BODY_BYTES } from "@webhook-broadcast/contract/env";
import type { Database } from "@webhook-broadcast/db";
import type { Pool } from "pg";
import { createOperatorAuthMiddleware, operatorLabelOf } from "./admin/auth.js";
import { registerAuthRoutes } from "./admin/authRoutes.js";
import { registerChannelFailureRoutes } from "./admin/channelFailures.js";
import { registerChannelRoutes } from "./admin/channels.js";
import { registerEndpointRoutes } from "./admin/endpoints.js";
import { registerChannelTokenRoutes } from "./admin/tokens.js";
import { registerOperatorTokenRoutes } from "./admin/operatorTokens.js";
import { registerBroadcastRoutes } from "./admin/broadcasts.js";
import { registerDeliveryRoutes } from "./admin/deliveries.js";
import { mergeIngestHeaderDenylist } from "./ingest/headers.js";
import { registerIngestRoutes } from "./ingest/routes.js";
import type { DeliveryQueue } from "./deliveryQueue.js";
import { logStructured } from "./observability/logger.js";
import type { MetricsCollector } from "./observability/metrics.js";
import { checkReadiness, type ReadinessChecks } from "./readiness.js";

export interface AppDeps {
  db: Database;
  pool?: Pool;
  deliveryQueue: DeliveryQueue;
  readinessCheck?: () => Promise<ReadinessChecks>;
  operatorApiKey: string;
  cookieName: string;
  cookieSecure?: boolean;
  trustProxy?: boolean;
  loginRateLimitMaxAttempts?: number;
  loginRateLimitWindowMs?: number;
  ingestMaxBodyBytes?: number;
  ingestHeaderAllowlist?: string[];
  ingestHeaderDenylist?: string[];
  metrics?: MetricsCollector;
  renderMetrics?: () => Promise<string>;
}

export function createApp(deps: AppDeps): Koa {
  const app = new Koa();
  app.proxy = true;

  const ingestRouter = new Router();
  registerIngestRoutes(ingestRouter, {
    db: deps.db,
    deliveryQueue: deps.deliveryQueue,
    maxBodyBytes: deps.ingestMaxBodyBytes ?? DEFAULT_INGEST_MAX_BODY_BYTES,
    headerAllowlist: deps.ingestHeaderAllowlist ?? [],
    headerDenylist: mergeIngestHeaderDenylist(deps.ingestHeaderDenylist ?? []),
    ...(deps.metrics ? { metrics: deps.metrics } : {}),
  });

  const router = new Router();

  router.get("/health", (ctx) => {
    ctx.status = 200;
    ctx.body = healthResponseSchema.parse({ status: "ok" });
  });

  // Postgres + Redis readiness (ADR 0008); liveness stays on /health above.
  router.get("/ready", async (ctx) => {
    const checks = deps.readinessCheck
      ? await deps.readinessCheck()
      : deps.pool
        ? await checkReadiness({ pool: deps.pool, deliveryQueue: deps.deliveryQueue })
        : { postgres: "fail" as const, redis: "fail" as const };
    const ready = checks.postgres === "ok" && checks.redis === "ok";
    ctx.status = ready ? 200 : 503;
    ctx.body = readyResponseSchema.parse({
      status: ready ? "ok" : "not_ready",
      checks,
    });
  });

  if (deps.renderMetrics) {
    router.get("/metrics", async (ctx) => {
      ctx.status = 200;
      ctx.type = "text/plain; version=0.0.4; charset=utf-8";
      ctx.body = await deps.renderMetrics!();
    });
  }

  registerAuthRoutes(router, {
    operatorApiKey: deps.operatorApiKey,
    cookieName: deps.cookieName,
    cookieSecure: deps.cookieSecure ?? false,
    trustProxy: deps.trustProxy ?? false,
    loginRateLimitMaxAttempts: deps.loginRateLimitMaxAttempts ?? 5,
    loginRateLimitWindowMs: deps.loginRateLimitWindowMs ?? 60_000,
  });

  const adminRouter = new Router();
  adminRouter.use(
    createOperatorAuthMiddleware({
      operatorApiKey: deps.operatorApiKey,
      cookieName: deps.cookieName,
      db: deps.db,
    }),
  );
  // Attributes admin mutations to the matched credential's label (issue
  // #41) — never the credential value itself. Runs after the handler so the
  // logged status reflects the outcome, not just that auth passed.
  adminRouter.use(async (ctx, next) => {
    await next();
    if (ctx.method !== "GET" && ctx.method !== "HEAD") {
      logStructured({
        msg: "admin mutation",
        method: ctx.method,
        path: ctx.path,
        statusCode: ctx.status,
        operatorLabel: operatorLabelOf(ctx),
      });
    }
  });
  // Lets the dashboard confirm an existing session cookie on load without a
  // side-effecting call to a resource endpoint.
  adminRouter.get("/auth/session", (ctx) => {
    ctx.status = 200;
    ctx.body = { ok: true };
  });
  registerChannelRoutes(adminRouter, deps.db);
  registerChannelFailureRoutes(adminRouter, deps.db);
  registerEndpointRoutes(adminRouter, deps.db);
  registerChannelTokenRoutes(adminRouter, deps.db);
  registerOperatorTokenRoutes(adminRouter, deps.db);
  registerBroadcastRoutes(adminRouter, { db: deps.db, deliveryQueue: deps.deliveryQueue });
  registerDeliveryRoutes(adminRouter, deps.db, deps.deliveryQueue);
  router.use(adminRouter.routes(), adminRouter.allowedMethods());

  app.use(async (ctx, next) => {
    try {
      await next();
    } catch (error) {
      console.error(JSON.stringify({ msg: "admin request failed", error: String(error) }));
      ctx.status = 500;
      ctx.body = errorBody("internal_error", "internal server error");
    }
  });
  // Ingest reads its own raw, unparsed body (see ingest/routes.ts) and must
  // run before @koa/bodyparser; unmatched paths fall through via `next()`.
  app.use(ingestRouter.routes());
  app.use(ingestRouter.allowedMethods());
  app.use(bodyParser());
  app.use(router.routes());
  app.use(router.allowedMethods());

  return app;
}
