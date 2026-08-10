import { z } from "zod";
import { dateTimeSchema, idSchema } from "./channel.js";
import { deliveryStatusSchema } from "./broadcast.js";

/**
 * Delivery detail (issue #21 AC): Endpoint identity plus the Delivery's
 * current status, addressed by Delivery id alone since it's already a
 * globally-unique UUID (ADR 0004's `GET /deliveries/:id`).
 */
export const deliveryDetailSchema = z.object({
  id: idSchema,
  broadcastId: idSchema,
  channelId: idSchema,
  endpointId: idSchema,
  endpointName: z.string().nullable(),
  endpointUrl: z.string(),
  status: deliveryStatusSchema,
  attemptCount: z.number().int().min(0),
  lastStatusCode: z.number().int().nullable(),
  lastDurationMs: z.number().int().nullable(),
  lastError: z.string().nullable(),
  updatedAt: dateTimeSchema,
});

export type DeliveryDetail = z.infer<typeof deliveryDetailSchema>;

/** One row of the Delivery detail's Attempt timeline — never the response body (CONTEXT.md). */
export const attemptSchema = z.object({
  id: idSchema,
  n: z.number().int().min(1),
  statusCode: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  error: z.string().nullable(),
  at: dateTimeSchema,
});

export type Attempt = z.infer<typeof attemptSchema>;

/** Nested under a Delivery — no paging for MVP; `nextCursor` stays null (ADR 0005). */
export const attemptListSchema = z.object({
  items: z.array(attemptSchema),
  nextCursor: z.string().nullable(),
});

export type AttemptList = z.infer<typeof attemptListSchema>;
