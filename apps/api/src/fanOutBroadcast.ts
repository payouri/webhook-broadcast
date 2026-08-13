import {
  createDeliveriesForBroadcast,
  deleteBroadcastById,
  insertBroadcast,
  listEnabledEndpointsByChannel,
  type BroadcastRow,
  type Database,
} from "@webhook-broadcast/db";
import type { DeliveryQueue } from "./deliveryQueue.js";
import { newRequestId } from "./deliveryQueue.js";

export interface FanOutBroadcastInput {
  db: Database;
  deliveryQueue: DeliveryQueue;
  broadcast: {
    id: string;
    channelId: string;
    receivedAt: Date;
    contentType: string;
    body: Buffer;
    headers: Record<string, string | string[]>;
  };
  /** One id per accept/replay fan-out — shared by every Delivery enqueued. */
  requestId?: string;
}

export interface FanOutBroadcastResult {
  broadcast: BroadcastRow;
  requestId: string;
  deliveryCount: number;
}

/**
 * Accept a Broadcast: persist the row and its Delivery snapshot in one
 * transaction, then enqueue every Delivery via `enqueueBulk`. Queue work
 * never precedes the DB commit; a failed enqueue rolls back the Broadcast
 * (Deliveries cascade) so ingest/replay never returns success with missing
 * queue work items or orphaned queue entries without rows.
 */
export async function fanOutBroadcast(input: FanOutBroadcastInput): Promise<FanOutBroadcastResult> {
  const requestId = input.requestId ?? newRequestId();
  const now = input.broadcast.receivedAt;

  const { broadcast, deliveries } = await input.db.transaction(async (tx) => {
    const broadcast = await insertBroadcast(tx, input.broadcast);
    const enabledEndpoints = await listEnabledEndpointsByChannel(tx, broadcast.channelId);
    const deliveries =
      enabledEndpoints.length > 0
        ? await createDeliveriesForBroadcast(tx, {
            broadcastId: broadcast.id,
            channelId: broadcast.channelId,
            endpointIds: enabledEndpoints.map((endpoint) => endpoint.id),
            now,
          })
        : [];
    return { broadcast, deliveries };
  });

  if (deliveries.length === 0) {
    return { broadcast, requestId, deliveryCount: 0 };
  }

  try {
    await input.deliveryQueue.enqueueBulk(
      deliveries.map((delivery) => ({
        deliveryId: delivery.id,
        requestId,
        channelId: broadcast.channelId,
        broadcastId: broadcast.id,
        endpointId: delivery.endpointId,
      })),
    );
  } catch (error) {
    await deleteBroadcastById(input.db, broadcast.id);
    throw error;
  }

  return { broadcast, requestId, deliveryCount: deliveries.length };
}
