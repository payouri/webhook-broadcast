import Koa from "koa";
import Router from "@koa/router";
import { healthResponseSchema, readyResponseSchema } from "@webhook-broadcast/contract";

export function createApp(): Koa {
  const app = new Koa();
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

  app.use(router.routes());
  app.use(router.allowedMethods());

  return app;
}
