import { randomUUID } from "node:crypto";
import type Router from "@koa/router";
import {
  broadcastListQuerySchema,
  broadcastReplayAcceptedSchema,
  errorBody,
  type BroadcastDetail,
  type BroadcastList,
} from "@webhook-broadcast/contract";
import {
  decodeBroadcastCursor,
  encodeBroadcastCursor,
  getBroadcastById,
  getFanoutSummariesByBroadcastIds,
  listBroadcastsByChannel,
  listDeliveriesForBroadcast,
  EMPTY_FANOUT_SUMMARY,
  type Database,
} from "@webhook-broadcast/db";
import type { DeliveryQueue } from "../deliveryQueue.js";
import { fanOutBroadcast } from "../fanOutBroadcast.js";
import { requireChannel } from "./requireChannel.js";
import { requireUuidParam, parseListCursor, toDetails } from "./validation.js";

const BODY_PREVIEW_MAX_LENGTH = 200;

export interface BroadcastRouteConfig {
  db: Database;
  deliveryQueue: DeliveryQueue;
}

function toBodyPreview(body: Buffer): string {
  const text = body.toString("utf8");
  return text.length > BODY_PREVIEW_MAX_LENGTH
    ? `${text.slice(0, BODY_PREVIEW_MAX_LENGTH)}…`
    : text;
}

/** Channel Activity: newest-first Broadcasts with cursor pages (issue #17). */
export function registerBroadcastRoutes(router: Router, config: BroadcastRouteConfig): void {
  const { db, deliveryQueue } = config;
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

    if (!(await requireChannel(ctx, db, channelId))) {
      return;
    }

    const cursor = parseListCursor(ctx, parsedQuery.data.cursor, decodeBroadcastCursor);
    if (cursor === null) {
      return;
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

  /** Broadcast detail (issue #19): inbound payload plus every fanned-out Delivery. */
  router.get("/channels/:channelId/broadcasts/:broadcastId", async (ctx) => {
    const channelId = requireUuidParam(ctx, "channelId");
    if (!channelId) {
      return;
    }
    const broadcastId = requireUuidParam(ctx, "broadcastId");
    if (!broadcastId) {
      return;
    }

    if (!(await requireChannel(ctx, db, channelId))) {
      return;
    }

    const broadcast = await getBroadcastById(db, channelId, broadcastId);
    if (!broadcast) {
      ctx.status = 404;
      ctx.body = errorBody("not_found", "broadcast not found");
      return;
    }

    const deliveries = await listDeliveriesForBroadcast(db, broadcast.id);

    const detail: BroadcastDetail = {
      id: broadcast.id,
      channelId: broadcast.channelId,
      receivedAt: broadcast.receivedAt.toISOString(),
      contentType: broadcast.contentType,
      body: broadcast.body.toString("utf8"),
      deliveries: deliveries.map((delivery) => ({
        id: delivery.id,
        endpointId: delivery.endpointId,
        endpointName: delivery.endpointName,
        endpointUrl: delivery.endpointUrl,
        status: delivery.status,
        attemptCount: delivery.attemptCount,
        lastStatusCode: delivery.lastStatusCode,
        lastDurationMs: delivery.lastDurationMs,
        lastError: delivery.lastError,
        updatedAt: delivery.updatedAt.toISOString(),
      })),
    };
    ctx.status = 200;
    ctx.body = detail;
  });

  /**
   * Replay (issue #22): while the original Broadcast is still retained
   * (ADR 0002 — its row exists), accept a brand-new Broadcast carrying the
   * stored body/headers/contentType and fan it out to the Endpoints enabled
   * on the Channel *right now*. Reusing the original `broadcastId` for the
   * new Deliveries would collide with the `(broadcast_id, endpoint_id)`
   * unique constraint (ADR 0007) on any Endpoint replayed more than once —
   * a new Broadcast row sidesteps that entirely and matches the locked
   * `202`/`{ id }` shape in docs/contracts/admin.openapi.yaml.
   */
  router.post("/channels/:channelId/broadcasts/:broadcastId/replay", async (ctx) => {
    const channelId = requireUuidParam(ctx, "channelId");
    if (!channelId) {
      return;
    }
    const broadcastId = requireUuidParam(ctx, "broadcastId");
    if (!broadcastId) {
      return;
    }

    if (!(await requireChannel(ctx, db, channelId))) {
      return;
    }

    const original = await getBroadcastById(db, channelId, broadcastId);
    if (!original) {
      ctx.status = 404;
      ctx.body = errorBody("not_found", "broadcast not found");
      return;
    }

    const now = new Date();
    const { broadcast: replay } = await fanOutBroadcast({
      db,
      deliveryQueue,
      broadcast: {
        id: randomUUID(),
        channelId: original.channelId,
        receivedAt: now,
        contentType: original.contentType,
        body: original.body,
        headers: original.headers,
      },
    });

    ctx.status = 202;
    ctx.body = broadcastReplayAcceptedSchema.parse({ id: replay.id });
  });
}
