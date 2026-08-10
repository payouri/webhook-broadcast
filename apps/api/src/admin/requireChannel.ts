import type { Context } from "koa";
import { errorBody } from "@webhook-broadcast/contract";
import { getChannelById, type Database } from "@webhook-broadcast/db";

/** 404s when the Channel row is missing so nested routes share one guard. */
export async function requireChannel(
  ctx: Context,
  db: Database,
  channelId: string,
): Promise<boolean> {
  const channel = await getChannelById(db, channelId);
  if (!channel) {
    ctx.status = 404;
    ctx.body = errorBody("not_found", "channel not found");
    return false;
  }
  return true;
}
