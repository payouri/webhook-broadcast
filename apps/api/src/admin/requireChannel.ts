import type { Context } from "koa";
import { errorBody } from "@webhook-broadcast/contract";
import { getChannelById, type ChannelRow, type Database } from "@webhook-broadcast/db";

/**
 * What the guard stashes for the nested route behind it (issue #114). The row
 * is already in hand once the 404 branch has been cleared, so a route that
 * needs the Channel's own fields reads it back instead of paying a second
 * point read.
 */
export interface GuardedChannelState {
  channel: ChannelRow;
}

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
  (ctx.state as GuardedChannelState).channel = channel;
  return true;
}

/**
 * Reads back what the guard stored. Koa types `ctx.state` as an open bag, so
 * this is the one place that narrows it — callers get a `ChannelRow` rather
 * than `any`. Only sound *after* `requireChannel` has returned `true` on this
 * request, which is the only way past the guard; it throws rather than
 * returning `undefined` so a caller that gets the order wrong fails loudly
 * instead of silently serving a response built from a missing Channel.
 */
export function guardedChannelOf(ctx: Context): ChannelRow {
  const state = ctx.state as Partial<GuardedChannelState>;
  if (!state.channel) {
    throw new Error("guardedChannelOf called before requireChannel passed on this request");
  }
  return state.channel;
}
