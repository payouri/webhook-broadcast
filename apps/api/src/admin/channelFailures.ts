import type Router from "@koa/router";
import type { ChannelFailureRollup } from "@webhook-broadcast/contract";
import { getFailureRollupForChannel, type Database } from "@webhook-broadcast/db";
import { requireChannel } from "./requireChannel.js";
import { requireUuidParam } from "./validation.js";

/**
 * Issue #84: the ranked failure roll-up behind the Channel Activity's
 * "group failures by Endpoint" view — see `getFailureRollupForChannel` for
 * the ranking rule and its shared window/predicate with the Channel
 * directory badge.
 */
export function registerChannelFailureRoutes(router: Router, db: Database): void {
  router.get("/channels/:channelId/failures", async (ctx) => {
    const channelId = requireUuidParam(ctx, "channelId");
    if (!channelId) {
      return;
    }

    if (!(await requireChannel(ctx, db, channelId))) {
      return;
    }

    const rows = await getFailureRollupForChannel(db, channelId, new Date());

    const body: ChannelFailureRollup = {
      items: rows.map((row) => ({
        endpointId: row.endpointId,
        endpointName: row.endpointName,
        endpointUrl: row.endpointUrl,
        failed: row.failed,
        deadLettered: row.deadLettered,
        autoDisabledAt: row.autoDisabledAt ? row.autoDisabledAt.toISOString() : null,
        lastFailureAt: row.lastFailureAt.toISOString(),
      })),
    };
    ctx.status = 200;
    ctx.body = body;
  });
}
