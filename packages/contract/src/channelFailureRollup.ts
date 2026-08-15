import { z } from "zod";
import { dateTimeSchema, idSchema } from "./channel.js";

/**
 * Issue #84: one entry per Endpoint of a Channel with at least one
 * `failed`/`dead_lettered` Delivery inside the recent-failure window
 * (`CHANNEL_RECENT_FAILURE_WINDOW_MS`, the same window the Channel
 * directory's badge already uses) — the reactive path this leads an
 * operator to is "which Endpoint is broken", not "which of 44 identical
 * rows do I read next" (PRODUCT.md's density-without-ranking anti-reference).
 */
export const endpointFailureSchema = z
  .object({
    endpointId: idSchema,
    endpointName: z.string().nullable(),
    endpointUrl: z.string(),
    failed: z.number().int().min(0),
    deadLettered: z.number().int().min(0),
    autoDisabledAt: dateTimeSchema.nullable().meta({
      description:
        "Non-null when this Endpoint is currently auto-disabled (ADR 0003) — ranks this entry " +
        "above every non-auto-disabled Endpoint regardless of counts, since an auto-disabled " +
        "Endpoint has stopped delivering and its counts have stopped growing.",
    }),
    lastFailureAt: dateTimeSchema,
  })
  .meta({ id: "EndpointFailure" });

export type EndpointFailure = z.infer<typeof endpointFailureSchema>;

/**
 * `GET /channels/{channelId}/failures` (issue #84): unpaginated — bounded by
 * the Channel's own Endpoint count (ADR 0001: an Endpoint belongs to exactly
 * one Channel) — and ordered severity-first in SQL: auto-disabled first,
 * then `deadLettered` desc, then `failed` desc, then `lastFailureAt` desc.
 */
export const channelFailureRollupSchema = z
  .object({
    items: z.array(endpointFailureSchema),
  })
  .meta({ id: "ChannelFailureRollup" });

export type ChannelFailureRollup = z.infer<typeof channelFailureRollupSchema>;
