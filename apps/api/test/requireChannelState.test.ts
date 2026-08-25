import type { Context } from "koa";
import type { ChannelRow } from "@webhook-broadcast/db";
import { describe, expect, it } from "vitest";
import { guardedChannelOf, type GuardedChannelState } from "../src/admin/requireChannel.js";

/**
 * The guard's stash seam (issue #114), tested without a database: what
 * `requireChannel` puts on `ctx.state` and what a nested route reads back. The
 * round trip through a real request is already covered by the Broadcast detail
 * tests in `broadcasts.test.ts`, which would 500 rather than 200 if the guard
 * stopped stashing the row.
 */
describe("guardedChannelOf (issue #114)", () => {
  const channel = { id: "0198f000-0000-7000-8000-000000000000" } as ChannelRow;

  it("returns the row requireChannel stashed on ctx.state", () => {
    const ctx = { state: { channel } satisfies GuardedChannelState } as unknown as Context;
    expect(guardedChannelOf(ctx)).toBe(channel);
  });

  it("throws rather than returning undefined when called before the guard has passed", () => {
    const ctx = { state: {} } as unknown as Context;
    expect(() => guardedChannelOf(ctx)).toThrow(/before requireChannel passed/);
  });
});
