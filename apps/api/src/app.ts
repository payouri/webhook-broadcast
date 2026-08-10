import Koa from "koa";
import Router from "@koa/router";
import { bodyParser } from "@koa/bodyparser";
import { errorBody, healthResponseSchema, readyResponseSchema } from "@webhook-broadcast/contract";
import type { Database } from "@webhook-broadcast/db";
import { createOperatorAuthMiddleware } from "./admin/auth.js";
import { registerAuthRoutes } from "./admin/authRoutes.js";
import { registerChannelRoutes } from "./admin/channels.js";
import { registerEndpointRoutes } from "./admin/endpoints.js";
import { registerChannelTokenRoutes } from "./admin/tokens.js";
import { registerBroadcastRoutes } from "./admin/broadcasts.js";
import { registerIngestRoutes } from "./ingest/routes.js";
import type { DeliveryQueue } from "./deliveryQueue.js";

/** Mirrors ADR 0008's `INGEST_MAX_BODY_BYTES` default. */
const DEFAULT_INGEST_MAX_BODY_BYTES = 1_048_576;

export interface AppDeps {
  db: Database;
  deliveryQueue: DeliveryQueue;
  operatorApiKey: string;
  cookieName: string;
  ingestMaxBodyBytes?: number;
  ingestHeaderAllowlist?: string[];
  ingestHeaderDenylist?: string[];
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
    headerDenylist: deps.ingestHeaderDenylist ?? [],
  });

  const router = new Router();

  router.get("/health", (ctx) => {
    ctx.status = 200;
    ctx.body = healthResponseSchema.parse({ status: "ok" });
  });

  // Stubbed until Postgres/Redis dependency checks land in a later slice.
  router.get("/ready", (ctx) => {
    ctx.status = 200;
    ctx.body = readyResponseSchema.parse({ status: "ok", checks: {} });
  });

  registerAuthRoutes(router, { operatorApiKey: deps.operatorApiKey, cookieName: deps.cookieName });

  const adminRouter = new Router();
  adminRouter.use(
    createOperatorAuthMiddleware({
      operatorApiKey: deps.operatorApiKey,
      cookieName: deps.cookieName,
    }),
  );
  // Lets the dashboard confirm an existing session cookie on load without a
  // side-effecting call to a resource endpoint.
  adminRouter.get("/auth/session", (ctx) => {
    ctx.status = 200;
    ctx.body = { ok: true };
  });
  registerChannelRoutes(adminRouter, deps.db);
  registerEndpointRoutes(adminRouter, deps.db);
  registerChannelTokenRoutes(adminRouter, deps.db);
  registerBroadcastRoutes(adminRouter, { db: deps.db, deliveryQueue: deps.deliveryQueue });
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
