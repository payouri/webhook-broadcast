import { z } from "zod";
import { dateTimeSchema, idSchema } from "./channel.js";

/**
 * Fan-out is computed in SQL from Delivery rows (ADR 0007), not stored on
 * Broadcast — `pending` folds in `in_progress` per the admin contract sketch.
 */
export const fanoutSummarySchema = z.object({
  total: z.number().int().min(0),
  succeeded: z.number().int().min(0),
  failed: z.number().int().min(0),
  deadLettered: z.number().int().min(0),
  pending: z.number().int().min(0),
});

export type FanoutSummary = z.infer<typeof fanoutSummarySchema>;

export const broadcastListItemSchema = z.object({
  id: idSchema,
  channelId: idSchema,
  receivedAt: dateTimeSchema,
  bodyPreview: z.string(),
  fanout: fanoutSummarySchema,
});

export type BroadcastListItem = z.infer<typeof broadcastListItemSchema>;

export const broadcastListSchema = z.object({
  items: z.array(broadcastListItemSchema),
  nextCursor: z.string().nullable(),
});

export type BroadcastList = z.infer<typeof broadcastListSchema>;

export const broadcastListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type BroadcastListQuery = z.infer<typeof broadcastListQuerySchema>;
