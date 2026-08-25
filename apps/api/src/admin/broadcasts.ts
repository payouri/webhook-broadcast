import { randomUUID } from "node:crypto";
import type Router from "@koa/router";
import {
  broadcastListQuerySchema,
  broadcastReplayAcceptedSchema,
  errorBody,
  type BroadcastDetail,
  type BroadcastList,
  type BroadcastListItem,
} from "@webhook-broadcast/contract";
import {
  decodeBroadcastCursor,
  encodeBroadcastCursor,
  getBroadcastById,
  getFanoutSummariesByBroadcastIds,
  listBroadcastsByChannel,
  listBroadcastsForEndpointFailures,
  listDeliveriesForBroadcast,
  EMPTY_FANOUT_SUMMARY,
  type BroadcastRow,
  type BroadcastWithEndpointDeliveryRow,
  type Database,
} from "@webhook-broadcast/db";
import type { DeliveryQueue } from "../deliveryQueue.js";
import { fanOutBroadcast } from "../fanOutBroadcast.js";
import { fingerprintForwardedHeaders } from "./forwardedHeaderFingerprints.js";
import { guardedChannelOf, requireChannel } from "./requireChannel.js";
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

/**
 * The one place a `BroadcastRow` becomes a list item, so the filtered and
 * unfiltered branches below can never drift apart on the shared fields. The
 * optional `delivery` block (issue #84) is present only for rows that carry
 * one Endpoint's Delivery facts.
 */
function toBroadcastListItem(
  row: BroadcastRow | BroadcastWithEndpointDeliveryRow,
  fanout: BroadcastListItem["fanout"],
): BroadcastListItem {
  const item: BroadcastListItem = {
    id: row.id,
    channelId: row.channelId,
    receivedAt: row.receivedAt.toISOString(),
    bodyPreview: toBodyPreview(row.body),
    fanout,
  };
  if (!("deliveryId" in row)) {
    return item;
  }
  return {
    ...item,
    delivery: {
      deliveryId: row.deliveryId,
      status: row.deliveryStatus,
      lastStatusCode: row.lastStatusCode,
      lastDurationMs: row.lastDurationMs,
      lastError: row.lastError,
      attemptCount: row.attemptCount,
    },
  };
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

    // Issue #84: `endpointId` + `status=failed` (validated as arriving
    // together by the contract schema's superRefine) narrow this call to the
    // Broadcasts whose Delivery to that one Endpoint failed or
    // dead-lettered — additive, so the unfiltered branch below is untouched.
    if (parsedQuery.data.endpointId !== undefined) {
      const { items, nextCursor } = await listBroadcastsForEndpointFailures(db, {
        channelId,
        endpointId: parsedQuery.data.endpointId,
        cursor,
        limit: parsedQuery.data.limit,
      });
      const fanoutByBroadcastId = await getFanoutSummariesByBroadcastIds(
        db,
        items.map((item) => item.id),
      );

      const body: BroadcastList = {
        items: items.map((item) =>
          toBroadcastListItem(item, fanoutByBroadcastId.get(item.id) ?? EMPTY_FANOUT_SUMMARY),
        ),
        nextCursor: nextCursor ? encodeBroadcastCursor(nextCursor) : null,
      };
      ctx.status = 200;
      ctx.body = body;
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
      items: items.map((item) =>
        toBroadcastListItem(item, fanoutByBroadcastId.get(item.id) ?? EMPTY_FANOUT_SUMMARY),
      ),
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

    // `forwardHeaders` comes from the row the guard just loaded (issue #114),
    // so the 404 above is the only one — no second read, no second branch to
    // keep in step with it.
    const channel = guardedChannelOf(ctx);

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
      // Issue #112: `undefined` for a Channel that forwards nothing, which
      // Koa's JSON serialisation drops — so those responses keep their exact
      // previous shape.
      forwardedHeaders: fingerprintForwardedHeaders(broadcast.headers, channel.forwardHeaders),
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
