import { randomUUID } from "node:crypto";
import type Router from "@koa/router";
import type { Context } from "koa";
import {
  endpointCreateSchema,
  endpointListQuerySchema,
  endpointUpdateSchema,
  errorBody,
  type Endpoint,
} from "@webhook-broadcast/contract";
import {
  decodeEndpointCursor,
  encodeEndpointCursor,
  EndpointUrlConflictError,
  getChannelById,
  getEndpointById,
  getEndpointHealthByIds,
  insertEndpoint,
  listEndpoints,
  updateEndpoint,
  type Database,
  type EndpointHealthRow,
  type EndpointRow,
} from "@webhook-broadcast/db";
import { requireUuidParam, toDetails } from "./validation.js";

function toWireEndpoint(row: EndpointRow, health?: EndpointHealthRow): Endpoint {
  return {
    id: row.id,
    channelId: row.channelId,
    name: row.name,
    url: row.url,
    timeoutMs: row.timeoutMs,
    headers: row.headers,
    enabled: row.enabled,
    autoDisabledAt: row.autoDisabledAt?.toISOString() ?? null,
    successRate24h: health?.successRate24h ?? null,
    p95Ms: health?.p95Ms ?? null,
    lastSuccessAt: health?.lastSuccessAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Endpoints are always addressed through their owning Channel (ADR 0001);
 * every route below 404s up front if that Channel doesn't exist.
 */
async function requireChannel(ctx: Context, db: Database, channelId: string): Promise<boolean> {
  const channel = await getChannelById(db, channelId);
  if (!channel) {
    ctx.status = 404;
    ctx.body = errorBody("not_found", "channel not found");
    return false;
  }
  return true;
}

export function registerEndpointRoutes(router: Router, db: Database): void {
  router.get("/channels/:channelId/endpoints", async (ctx) => {
    const channelId = requireUuidParam(ctx, "channelId");
    if (!channelId) {
      return;
    }
    if (!(await requireChannel(ctx, db, channelId))) {
      return;
    }

    const parsedQuery = endpointListQuerySchema.safeParse(ctx.query);
    if (!parsedQuery.success) {
      ctx.status = 400;
      ctx.body = errorBody("validation_failed", "invalid query", toDetails(parsedQuery.error));
      return;
    }

    let cursor;
    if (parsedQuery.data.cursor) {
      cursor = decodeEndpointCursor(parsedQuery.data.cursor);
      if (!cursor) {
        ctx.status = 400;
        ctx.body = errorBody("validation_failed", "invalid cursor");
        return;
      }
    }

    const { items, nextCursor } = await listEndpoints(db, channelId, {
      cursor,
      limit: parsedQuery.data.limit,
    });
    const healthById = await getEndpointHealthByIds(
      db,
      items.map((item) => item.id),
    );
    ctx.status = 200;
    ctx.body = {
      items: items.map((item) => toWireEndpoint(item, healthById.get(item.id))),
      nextCursor: nextCursor ? encodeEndpointCursor(nextCursor) : null,
    };
  });

  router.post("/channels/:channelId/endpoints", async (ctx) => {
    const channelId = requireUuidParam(ctx, "channelId");
    if (!channelId) {
      return;
    }
    if (!(await requireChannel(ctx, db, channelId))) {
      return;
    }

    const parsedBody = endpointCreateSchema.safeParse(ctx.request.body);
    if (!parsedBody.success) {
      ctx.status = 400;
      ctx.body = errorBody(
        "validation_failed",
        "invalid endpoint payload",
        toDetails(parsedBody.error),
      );
      return;
    }

    const now = new Date();
    try {
      const row = await insertEndpoint(db, {
        id: randomUUID(),
        channelId,
        name: parsedBody.data.name ?? null,
        url: parsedBody.data.url,
        timeoutMs: parsedBody.data.timeoutMs ?? null,
        headers: parsedBody.data.headers ?? {},
        enabled: parsedBody.data.enabled,
        createdAt: now,
        updatedAt: now,
      });
      ctx.status = 201;
      ctx.body = toWireEndpoint(row);
    } catch (error) {
      if (error instanceof EndpointUrlConflictError) {
        ctx.status = 409;
        ctx.body = errorBody("conflict", error.message);
        return;
      }
      throw error;
    }
  });

  router.get("/channels/:channelId/endpoints/:endpointId", async (ctx) => {
    const channelId = requireUuidParam(ctx, "channelId");
    if (!channelId) {
      return;
    }
    const endpointId = requireUuidParam(ctx, "endpointId");
    if (!endpointId) {
      return;
    }
    if (!(await requireChannel(ctx, db, channelId))) {
      return;
    }

    const row = await getEndpointById(db, channelId, endpointId);
    if (!row) {
      ctx.status = 404;
      ctx.body = errorBody("not_found", "endpoint not found");
      return;
    }
    const healthById = await getEndpointHealthByIds(db, [row.id]);
    ctx.status = 200;
    ctx.body = toWireEndpoint(row, healthById.get(row.id));
  });

  router.patch("/channels/:channelId/endpoints/:endpointId", async (ctx) => {
    const channelId = requireUuidParam(ctx, "channelId");
    if (!channelId) {
      return;
    }
    const endpointId = requireUuidParam(ctx, "endpointId");
    if (!endpointId) {
      return;
    }
    if (!(await requireChannel(ctx, db, channelId))) {
      return;
    }

    const parsedBody = endpointUpdateSchema.safeParse(ctx.request.body);
    if (!parsedBody.success) {
      ctx.status = 400;
      ctx.body = errorBody(
        "validation_failed",
        "invalid endpoint payload",
        toDetails(parsedBody.error),
      );
      return;
    }

    try {
      const row = await updateEndpoint(db, channelId, endpointId, {
        ...parsedBody.data,
        ...(parsedBody.data.enabled === true ? { autoDisabledAt: null } : {}),
        updatedAt: new Date(),
      });
      if (!row) {
        ctx.status = 404;
        ctx.body = errorBody("not_found", "endpoint not found");
        return;
      }
      const healthById = await getEndpointHealthByIds(db, [row.id]);
      ctx.status = 200;
      ctx.body = toWireEndpoint(row, healthById.get(row.id));
    } catch (error) {
      if (error instanceof EndpointUrlConflictError) {
        ctx.status = 409;
        ctx.body = errorBody("conflict", error.message);
        return;
      }
      throw error;
    }
  });
}
