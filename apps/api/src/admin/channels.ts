import { randomUUID } from "node:crypto";
import type Router from "@koa/router";
import {
  channelCreateSchema,
  channelListQuerySchema,
  channelUpdateSchema,
  errorBody,
  type Channel,
} from "@webhook-broadcast/contract";
import {
  ChannelSlugConflictError,
  decodeChannelCursor,
  encodeChannelCursor,
  getChannelById,
  getEndpointCountsByChannelIds,
  getTokenSummariesByChannelIds,
  insertChannel,
  listChannels,
  softDeleteChannel,
  updateChannel,
  type ChannelRow,
  type ChannelTokenSummaryRow,
  type Database,
} from "@webhook-broadcast/db";
import { requireUuidParam, parseListCursor, toDetails } from "./validation.js";

function toWireChannel(
  row: ChannelRow,
  endpointCount: number,
  tokens: ChannelTokenSummaryRow[],
): Channel {
  return {
    id: row.id,
    slug: row.slug,
    description: row.description,
    enabled: row.enabled,
    endpointCount,
    tokens: tokens.map((token) => ({
      id: token.id,
      prefix: token.prefix,
      createdAt: token.createdAt.toISOString(),
    })),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Endpoint count and token summaries are separate tables — hydrate in one batched pass per response. */
async function hydrateChannels(db: Database, rows: ChannelRow[]): Promise<Channel[]> {
  const ids = rows.map((row) => row.id);
  const [counts, tokens] = await Promise.all([
    getEndpointCountsByChannelIds(db, ids),
    getTokenSummariesByChannelIds(db, ids),
  ]);
  return rows.map((row) => toWireChannel(row, counts.get(row.id) ?? 0, tokens.get(row.id) ?? []));
}

export function registerChannelRoutes(router: Router, db: Database): void {
  router.get("/channels", async (ctx) => {
    const parsedQuery = channelListQuerySchema.safeParse(ctx.query);
    if (!parsedQuery.success) {
      ctx.status = 400;
      ctx.body = errorBody("validation_failed", "invalid query", toDetails(parsedQuery.error));
      return;
    }

    const cursor = parseListCursor(ctx, parsedQuery.data.cursor, decodeChannelCursor);
    if (cursor === null) {
      return;
    }

    const { items, nextCursor } = await listChannels(db, { cursor, limit: parsedQuery.data.limit });
    ctx.status = 200;
    ctx.body = {
      items: await hydrateChannels(db, items),
      nextCursor: nextCursor ? encodeChannelCursor(nextCursor) : null,
    };
  });

  router.post("/channels", async (ctx) => {
    const parsedBody = channelCreateSchema.safeParse(ctx.request.body);
    if (!parsedBody.success) {
      ctx.status = 400;
      ctx.body = errorBody(
        "validation_failed",
        "invalid channel payload",
        toDetails(parsedBody.error),
      );
      return;
    }

    const now = new Date();
    try {
      const row = await insertChannel(db, {
        id: randomUUID(),
        slug: parsedBody.data.slug,
        description: parsedBody.data.description ?? null,
        enabled: parsedBody.data.enabled,
        createdAt: now,
        updatedAt: now,
      });
      const [channel] = await hydrateChannels(db, [row]);
      ctx.status = 201;
      ctx.body = channel;
    } catch (error) {
      if (error instanceof ChannelSlugConflictError) {
        ctx.status = 409;
        ctx.body = errorBody("conflict", error.message);
        return;
      }
      throw error;
    }
  });

  router.get("/channels/:channelId", async (ctx) => {
    const channelId = requireUuidParam(ctx, "channelId");
    if (!channelId) {
      return;
    }

    const row = await getChannelById(db, channelId);
    if (!row) {
      ctx.status = 404;
      ctx.body = errorBody("not_found", "channel not found");
      return;
    }

    const [channel] = await hydrateChannels(db, [row]);
    ctx.status = 200;
    ctx.body = channel;
  });

  router.patch("/channels/:channelId", async (ctx) => {
    const channelId = requireUuidParam(ctx, "channelId");
    if (!channelId) {
      return;
    }

    const parsedBody = channelUpdateSchema.safeParse(ctx.request.body);
    if (!parsedBody.success) {
      ctx.status = 400;
      ctx.body = errorBody(
        "validation_failed",
        "invalid channel payload",
        toDetails(parsedBody.error),
      );
      return;
    }

    try {
      const row = await updateChannel(db, channelId, { ...parsedBody.data, updatedAt: new Date() });
      if (!row) {
        ctx.status = 404;
        ctx.body = errorBody("not_found", "channel not found");
        return;
      }
      const [channel] = await hydrateChannels(db, [row]);
      ctx.status = 200;
      ctx.body = channel;
    } catch (error) {
      if (error instanceof ChannelSlugConflictError) {
        ctx.status = 409;
        ctx.body = errorBody("conflict", error.message);
        return;
      }
      throw error;
    }
  });

  router.delete("/channels/:channelId", async (ctx) => {
    const channelId = requireUuidParam(ctx, "channelId");
    if (!channelId) {
      return;
    }

    const deleted = await softDeleteChannel(db, channelId, new Date());
    if (!deleted) {
      ctx.status = 404;
      ctx.body = errorBody("not_found", "channel not found");
      return;
    }
    ctx.status = 204;
  });
}
