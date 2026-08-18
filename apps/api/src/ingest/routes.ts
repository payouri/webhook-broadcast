import { randomUUID } from "node:crypto";
import type Router from "@koa/router";
import { errorBody, ingestAcceptedSchema } from "@webhook-broadcast/contract";
import {
  findChannelTokenByHash,
  getActiveChannelBySlug,
  type Database,
} from "@webhook-broadcast/db";
import { extractBearerToken } from "../admin/auth.js";
import { hashToken } from "../tokens.js";
import type { DeliveryQueue } from "../deliveryQueue.js";
import { fanOutBroadcast } from "../fanOutBroadcast.js";
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
  /**
   * Issue #99: status answered on the accepted path when the Channel has no
   * `ingestSuccessStatus` of its own. Service-wide `INGEST_SUCCESS_STATUS`,
   * `202` by default.
   */
  successStatus: number;
  metrics?: MetricsCollector;
}

/**
 * `POST /ingest/:slug` — Channel-token auth, arbitrary body, outside the
 * published admin OpenAPI (ADR 0005). Mounted before `@koa/bodyparser` in
 * `app.ts` so the raw bytes reach `readLimitedBody` untouched.
 *
 * Issue #38: a Channel with `allowUnauthenticatedIngest` set skips the
 * token check entirely — the slug is then the only thing gating its
 * fan-out. Off by default; opt-in per Channel via the admin API.
 *
 * Issue #99: the accepted response's status is configurable — the Channel's
 * own `ingestSuccessStatus` when set, else the service-wide default — because
 * a producer whose success condition is literally `200` retries an event this
 * service already accepted, and every retry becomes another Broadcast fanned
 * out to every Endpoint. Only the accepted path moves; the 401/413 answers
 * above are unaffected.
 */
export function registerIngestRoutes(router: Router, config: IngestRouteConfig): void {
  router.post("/ingest/:slug", async (ctx) => {
    const { slug } = ctx.params as { slug: string };

    // Unknown slug always looks like "invalid ingest token" — including for
    // a request with no Authorization header at all — so a probe can never
    // distinguish "no such Channel" from "this Channel is open" (issue #38).
    const channel = await getActiveChannelBySlug(config.db, slug);
    if (!channel) {
      ctx.status = 401;
      ctx.body = errorBody("unauthorized", "invalid ingest token");
      return;
    }

    if (!channel.allowUnauthenticatedIngest) {
      const token = extractBearerToken(ctx.headers.authorization);
      if (!token) {
        ctx.status = 401;
        ctx.body = errorBody("unauthorized", "missing ingest token");
        return;
      }

      const channelToken = await findChannelTokenByHash(config.db, channel.id, hashToken(token));
      if (!channelToken) {
        ctx.status = 401;
        ctx.body = errorBody("unauthorized", "invalid ingest token");
        return;
      }
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

    const { broadcast, requestId, deliveryCount } = await fanOutBroadcast({
      db: config.db,
      deliveryQueue: config.deliveryQueue,
      broadcast: {
        id: randomUUID(),
        channelId: channel.id,
        receivedAt: new Date(),
        contentType: ctx.get("content-type") || "application/octet-stream",
        body,
        headers: filterHeaders(ctx.req.headers, config.headerAllowlist, config.headerDenylist),
      },
    });

    config.metrics?.ingestAcceptedTotal.inc();
    logStructured({
      msg: "ingest accepted",
      requestId,
      channelId: channel.id,
      broadcastId: broadcast.id,
      deliveryCount,
    });

    ctx.status = channel.ingestSuccessStatus ?? config.successStatus;
    ctx.body = ingestAcceptedSchema.parse({ id: broadcast.id });
  });
}
