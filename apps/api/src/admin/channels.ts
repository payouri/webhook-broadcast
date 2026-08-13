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
  OpenIngestSlugTooShortError,
  decodeChannelCursor,
  encodeChannelCursor,
  getAutoDisabledEndpointCountsByChannelIds,
  getChannelById,
  getChannelIdsWithAnyBroadcast,
  getEndpointCountsByChannelIds,
  getRecentFailureCountsByChannelIds,
  getTokenSummariesByChannelIds,
  insertChannel,
  listChannels,
  softDeleteChannel,
  updateChannel,
  type ChannelRecentFailureCountRow,
  type ChannelRow,
  type ChannelTokenSummaryRow,
  type Database,
} from "@webhook-broadcast/db";
import { requireUuidParam, parseListCursor, toDetails } from "./validation.js";

function toWireChannel(
  row: ChannelRow,
  endpointCount: number,
  tokens: ChannelTokenSummaryRow[],
  hasBroadcasts: boolean,
  recentFailures: ChannelRecentFailureCountRow | undefined,
  autoDisabledEndpointCount: number,
): Channel {
  return {
    id: row.id,
    slug: row.slug,
    description: row.description,
    enabled: row.enabled,
    forwardHeaders: row.forwardHeaders,
    allowUnauthenticatedIngest: row.allowUnauthenticatedIngest,
    endpointCount,
    hasBroadcasts,
    recentFailedDeliveryCount:
      (recentFailures?.failedCount ?? 0) + (recentFailures?.deadLetteredCount ?? 0),
    autoDisabledEndpointCount,
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

/**
 * Endpoint count, token summaries, the recent-failure aggregate (issue #44),
 * the auto-disabled-Endpoint aggregate (issue #45), and "has ever had a
 * Broadcast" are each hydrated in one batched pass per response — one
 * grouped query per aggregate for the whole page of Channels, never one
 * query per Channel.
 *
 * `now` defaults fresh for single-row callers (create/get/patch), but the
 * list route passes the exact `now` it gave `listChannels` so the displayed
 * `recentFailedDeliveryCount` can never disagree with the health rank that
 * ordered the page around it.
 */
async function hydrateChannels(
  db: Database,
  rows: ChannelRow[],
  now: Date = new Date(),
): Promise<Channel[]> {
  const ids = rows.map((row) => row.id);
  const [counts, tokens, everBroadcast, recentFailures, autoDisabledEndpointCounts] =
    await Promise.all([
      getEndpointCountsByChannelIds(db, ids),
      getTokenSummariesByChannelIds(db, ids),
      getChannelIdsWithAnyBroadcast(db, ids),
      getRecentFailureCountsByChannelIds(db, ids, now),
      getAutoDisabledEndpointCountsByChannelIds(db, ids),
    ]);
  return rows.map((row) =>
    toWireChannel(
      row,
      counts.get(row.id) ?? 0,
      tokens.get(row.id) ?? [],
      everBroadcast.has(row.id),
      recentFailures.get(row.id),
      autoDisabledEndpointCounts.get(row.id) ?? 0,
    ),
  );
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

    const now = new Date();
    const { items, nextCursor } = await listChannels(db, {
      cursor,
      limit: parsedQuery.data.limit,
      slug: parsedQuery.data.slug,
      now,
    });
    ctx.status = 200;
    ctx.body = {
      items: await hydrateChannels(db, items, now),
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
        forwardHeaders: parsedBody.data.forwardHeaders,
        allowUnauthenticatedIngest: parsedBody.data.allowUnauthenticatedIngest,
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
      if (error instanceof OpenIngestSlugTooShortError) {
        ctx.status = 400;
        ctx.body = errorBody("validation_failed", error.message);
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
      if (error instanceof OpenIngestSlugTooShortError) {
        ctx.status = 400;
        ctx.body = errorBody("validation_failed", error.message);
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
