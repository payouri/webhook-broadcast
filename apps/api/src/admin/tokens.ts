import { randomUUID } from "node:crypto";
import type Router from "@koa/router";
import {
  channelTokenCreatedSchema,
  errorBody,
  type ChannelTokenCreated,
} from "@webhook-broadcast/contract";
import { insertChannelToken, revokeChannelToken, type Database } from "@webhook-broadcast/db";
import { mintChannelToken } from "../tokens.js";
import { requireChannel } from "./requireChannel.js";
import { requireUuidParam } from "./validation.js";

/**
 * Mint/revoke for Channel ingest tokens. Listing is not a separate route —
 * token summaries (`id`, `prefix`, `createdAt`) already ride along on the
 * Channel resource (see `admin/channels.ts` `hydrateChannels`).
 */
export function registerChannelTokenRoutes(router: Router, db: Database): void {
  router.post("/channels/:channelId/tokens", async (ctx) => {
    const channelId = requireUuidParam(ctx, "channelId");
    if (!channelId) {
      return;
    }

    if (!(await requireChannel(ctx, db, channelId))) {
      return;
    }

    const minted = mintChannelToken();
    const row = await insertChannelToken(db, {
      id: randomUUID(),
      channelId,
      tokenHash: minted.tokenHash,
      prefix: minted.prefix,
      createdAt: new Date(),
    });

    const body: ChannelTokenCreated = {
      id: row.id,
      token: minted.token,
      createdAt: row.createdAt.toISOString(),
    };
    ctx.status = 201;
    ctx.body = channelTokenCreatedSchema.parse(body);
  });

  router.delete("/channels/:channelId/tokens/:tokenId", async (ctx) => {
    const channelId = requireUuidParam(ctx, "channelId");
    if (!channelId) {
      return;
    }
    const tokenId = requireUuidParam(ctx, "tokenId");
    if (!tokenId) {
      return;
    }

    const revoked = await revokeChannelToken(db, channelId, tokenId);
    if (!revoked) {
      ctx.status = 404;
      ctx.body = errorBody("not_found", "token not found");
      return;
    }
    ctx.status = 204;
  });
}
