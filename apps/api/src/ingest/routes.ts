import { randomUUID } from "node:crypto";
import type Router from "@koa/router";
import { errorBody, ingestAcceptedSchema } from "@webhook-broadcast/contract";
import {
  findChannelTokenByHash,
  getActiveChannelBySlug,
  insertBroadcast,
  type Database,
} from "@webhook-broadcast/db";
import { extractBearerToken } from "../admin/auth.js";
import { hashChannelToken } from "../tokens.js";
import { filterHeaders } from "./headers.js";
import { PayloadTooLargeError, readLimitedBody } from "./readLimitedBody.js";

export interface IngestRouteConfig {
  db: Database;
  maxBodyBytes: number;
  headerAllowlist: string[];
  headerDenylist: string[];
}

/**
 * `POST /ingest/:slug` — Channel-token auth, arbitrary body, outside the
 * published admin OpenAPI (ADR 0005). Mounted before `@koa/bodyparser` in
 * `app.ts` so the raw bytes reach `readLimitedBody` untouched.
 */
export function registerIngestRoutes(router: Router, config: IngestRouteConfig): void {
  router.post("/ingest/:slug", async (ctx) => {
    const { slug } = ctx.params as { slug: string };

    const channel = await getActiveChannelBySlug(config.db, slug);
    if (!channel) {
      ctx.status = 404;
      ctx.body = errorBody("not_found", "channel not found");
      return;
    }

    const token = extractBearerToken(ctx.headers.authorization);
    if (!token) {
      ctx.status = 401;
      ctx.body = errorBody("unauthorized", "missing ingest token");
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

    ctx.status = 202;
    ctx.body = ingestAcceptedSchema.parse({ id: broadcast.id });
  });
}
