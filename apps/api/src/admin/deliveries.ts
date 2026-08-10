import type Router from "@koa/router";
import { errorBody, type Attempt, type DeliveryDetail } from "@webhook-broadcast/contract";
import {
  getDeliveryDetailById,
  listAttemptsForDelivery,
  retryDeadLetteredDelivery,
  type AttemptRow,
  type DeliveryDetailRow,
  type Database,
} from "@webhook-broadcast/db";
import type { DeliveryQueue } from "../deliveryQueue.js";
import { requireUuidParam } from "./validation.js";

function toWireDeliveryDetail(row: DeliveryDetailRow): DeliveryDetail {
  return {
    id: row.id,
    broadcastId: row.broadcastId,
    channelId: row.channelId,
    endpointId: row.endpointId,
    endpointName: row.endpointName,
    endpointUrl: row.endpointUrl,
    status: row.status,
    attemptCount: row.attemptCount,
    lastStatusCode: row.lastStatusCode,
    lastDurationMs: row.lastDurationMs,
    lastError: row.lastError,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toWireAttempt(row: AttemptRow): Attempt {
  return {
    id: row.id,
    n: row.n,
    statusCode: row.statusCode,
    durationMs: row.durationMs,
    error: row.error,
    at: row.at.toISOString(),
  };
}

/** Delivery detail + Retry Delivery (issue #21): addressed by Delivery id alone (ADR 0004). */
export function registerDeliveryRoutes(
  router: Router,
  db: Database,
  deliveryQueue: DeliveryQueue,
): void {
  router.get("/deliveries/:deliveryId", async (ctx) => {
    const deliveryId = requireUuidParam(ctx, "deliveryId");
    if (!deliveryId) {
      return;
    }

    const row = await getDeliveryDetailById(db, deliveryId);
    if (!row) {
      ctx.status = 404;
      ctx.body = errorBody("not_found", "delivery not found");
      return;
    }
    ctx.status = 200;
    ctx.body = toWireDeliveryDetail(row);
  });

  router.get("/deliveries/:deliveryId/attempts", async (ctx) => {
    const deliveryId = requireUuidParam(ctx, "deliveryId");
    if (!deliveryId) {
      return;
    }

    const delivery = await getDeliveryDetailById(db, deliveryId);
    if (!delivery) {
      ctx.status = 404;
      ctx.body = errorBody("not_found", "delivery not found");
      return;
    }

    const rows = await listAttemptsForDelivery(db, deliveryId);
    ctx.status = 200;
    ctx.body = { items: rows.map(toWireAttempt), nextCursor: null };
  });

  /**
   * Re-queues a `dead_lettered` Delivery only (ADR 0003) — distinct from
   * Broadcast Replay's re-fan-out. 409s for any other status instead of
   * silently no-oping, so the dashboard's Retry action only ever appears
   * (and only ever succeeds) for a Delivery that's actually dead-lettered.
   */
  router.post("/deliveries/:deliveryId/retry", async (ctx) => {
    const deliveryId = requireUuidParam(ctx, "deliveryId");
    if (!deliveryId) {
      return;
    }

    const retried = await retryDeadLetteredDelivery(db, deliveryId, new Date());
    if (!retried) {
      const existing = await getDeliveryDetailById(db, deliveryId);
      if (!existing) {
        ctx.status = 404;
        ctx.body = errorBody("not_found", "delivery not found");
        return;
      }
      ctx.status = 409;
      ctx.body = errorBody("conflict", "only dead_lettered Deliveries can be retried");
      return;
    }

    await deliveryQueue.enqueue(deliveryId);

    const row = await getDeliveryDetailById(db, deliveryId);
    if (!row) {
      // Vanished between the update and this read — extremely unlikely
      // (cascade delete on the parent Broadcast) but handled rather than 500ing.
      ctx.status = 404;
      ctx.body = errorBody("not_found", "delivery not found");
      return;
    }
    ctx.status = 200;
    ctx.body = toWireDeliveryDetail(row);
  });
}
