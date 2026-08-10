import type Router from "@koa/router";
import {
  broadcastListQuerySchema,
  errorBody,
  type BroadcastList,
} from "@webhook-broadcast/contract";
import {
  decodeBroadcastCursor,
  encodeBroadcastCursor,
  getChannelById,
  getFanoutSummariesByBroadcastIds,
  listBroadcastsByChannel,
  EMPTY_FANOUT_SUMMARY,
  type Database,
} from "@webhook-broadcast/db";
import { requireUuidParam, toDetails } from "./validation.js";

const BODY_PREVIEW_MAX_LENGTH = 200;

function toBodyPreview(body: Buffer): string {
  const text = body.toString("utf8");
  return text.length > BODY_PREVIEW_MAX_LENGTH
    ? `${text.slice(0, BODY_PREVIEW_MAX_LENGTH)}…`
    : text;
}

/** Channel Activity: newest-first Broadcasts with cursor pages (issue #17). */
export function registerBroadcastRoutes(router: Router, db: Database): void {
  router.get("/channels/:channelId/broadcasts", async (ctx) => {
    const channelId = requireUuidParam(ctx, "channelId");
    if (!channelId) {
      return;
    }

    const parsedQuery = broadcastListQuerySchema.safeParse(ctx.query);
    if (!parsedQuery.success) {
      ctx.status = 400;
      ctx.body = errorBody("validation_failed", "invalid query", toDetails(parsedQuery.error));
      return;
    }

    const channel = await getChannelById(db, channelId);
    if (!channel) {
      ctx.status = 404;
      ctx.body = errorBody("not_found", "channel not found");
      return;
    }

    let cursor;
    if (parsedQuery.data.cursor) {
      cursor = decodeBroadcastCursor(parsedQuery.data.cursor);
      if (!cursor) {
        ctx.status = 400;
        ctx.body = errorBody("validation_failed", "invalid cursor");
        return;
      }
    }

    const { items, nextCursor } = await listBroadcastsByChannel(db, {
      channelId,
      cursor,
      limit: parsedQuery.data.limit,
    });
    const fanoutByBroadcastId = await getFanoutSummariesByBroadcastIds(
      db,
      items.map((item) => item.id),
    );

    const body: BroadcastList = {
      items: items.map((item) => ({
        id: item.id,
        channelId: item.channelId,
        receivedAt: item.receivedAt.toISOString(),
        bodyPreview: toBodyPreview(item.body),
        fanout: fanoutByBroadcastId.get(item.id) ?? EMPTY_FANOUT_SUMMARY,
      })),
      nextCursor: nextCursor ? encodeBroadcastCursor(nextCursor) : null,
    };
    ctx.status = 200;
    ctx.body = body;
  });
}
