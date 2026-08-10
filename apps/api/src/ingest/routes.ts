import { randomUUID } from "node:crypto";
import type Router from "@koa/router";
import { errorBody, ingestAcceptedSchema } from "@webhook-broadcast/contract";
import {
  createDeliveriesForBroadcast,
  findChannelTokenByHash,
  getActiveChannelBySlug,
  insertBroadcast,
  listEnabledEndpointsByChannel,
  type Database,
} from "@webhook-broadcast/db";
import { extractBearerToken } from "../admin/auth.js";
import { hashChannelToken } from "../tokens.js";
import type { DeliveryQueue } from "../deliveryQueue.js";
import { newRequestId } from "../deliveryQueue.js";
import type { MetricsCollector } from "../observability/metrics.js";
import { logStructured } from "../observability/logger.js";
import { filterHeaders } from "./headers.js";
import { PayloadTooLargeError, readLimitedBody } from "./readLimitedBody.js";

export interface IngestRouteConfig {
  db: Database;
  deliveryQueue: DeliveryQueue;
  maxBodyBytes: number;
  headerAllowlist: string[];
  headerDenylist: string[];
  metrics?: MetricsCollector;
}

/**
 * `POST /ingest/:slug` — Channel-token auth, arbitrary body, outside the
 * published admin OpenAPI (ADR 0005). Mounted before `@koa/bodyparser` in
 * `app.ts` so the raw bytes reach `readLimitedBody` untouched.
 */
export function registerIngestRoutes(router: Router, config: IngestRouteConfig): void {
  router.post("/ingest/:slug", async (ctx) => {
    const { slug } = ctx.params as { slug: string };

    const token = extractBearerToken(ctx.headers.authorization);
    if (!token) {
      ctx.status = 401;
      ctx.body = errorBody("unauthorized", "missing ingest token");
      return;
    }

    const channel = await getActiveChannelBySlug(config.db, slug);
    if (!channel) {
      ctx.status = 401;
      ctx.body = errorBody("unauthorized", "invalid ingest token");
      return;
    }

    const channelToken = await findChannelTokenByHash(
      config.db,
      channel.id,
      hashChannelToken(token),
    );
    if (!channelToken) {
      ctx.status = 401;
      ctx.body = errorBody("unauthorized", "invalid ingest token");
      return;
    }

    // Fast-reject on a declared Content-Length before touching the socket;
    // the stream read below still enforces the cap for chunked bodies or a
    // sender that lies about the header.
    const declaredLength = ctx.request.length;
    if (typeof declaredLength === "number" && declaredLength > config.maxBodyBytes) {
      ctx.status = 413;
      ctx.body = errorBody("payload_too_large", `body exceeds ${config.maxBodyBytes} bytes`);
      return;
    }

    let body: Buffer;
    try {
      body = await readLimitedBody(ctx.req, config.maxBodyBytes);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        ctx.status = 413;
        ctx.body = errorBody("payload_too_large", error.message);
        return;
      }
      throw error;
    }

    const broadcast = await insertBroadcast(config.db, {
      id: randomUUID(),
      channelId: channel.id,
      receivedAt: new Date(),
      contentType: ctx.get("content-type") || "application/octet-stream",
      body,
      headers: filterHeaders(ctx.req.headers, config.headerAllowlist, config.headerDenylist),
    });

    const requestId = newRequestId();

    // Fan-out snapshot (CONTEXT.md's Broadcast/Delivery language): exactly
    // one Delivery per Endpoint enabled on this Channel right now, each
    // enqueued as its own job so the worker never processes more than one
    // Endpoint's Attempt per job.
    const enabledEndpoints = await listEnabledEndpointsByChannel(config.db, channel.id);
    if (enabledEndpoints.length > 0) {
      const createdDeliveries = await createDeliveriesForBroadcast(config.db, {
        broadcastId: broadcast.id,
        channelId: channel.id,
        endpointIds: enabledEndpoints.map((endpoint) => endpoint.id),
        now: new Date(),
      });
      await Promise.all(
        createdDeliveries.map((delivery) =>
          config.deliveryQueue.enqueue({
            deliveryId: delivery.id,
            requestId,
            channelId: channel.id,
            broadcastId: broadcast.id,
            endpointId: delivery.endpointId,
          }),
        ),
      );
    }

    config.metrics?.ingestAcceptedTotal.inc();
    logStructured({
      msg: "ingest accepted",
      requestId,
      channelId: channel.id,
      broadcastId: broadcast.id,
      deliveryCount: enabledEndpoints.length,
    });

    ctx.status = 202;
    ctx.body = ingestAcceptedSchema.parse({ id: broadcast.id });
  });
}
