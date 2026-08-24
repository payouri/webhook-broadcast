import { z } from "zod";
import { dateTimeSchema, idSchema } from "./channel.js";

/**
 * Fan-out is computed in SQL from Delivery rows (ADR 0007), not stored on
 * Broadcast — `pending` folds in `in_progress` per the admin contract sketch.
 */
export const fanoutSummarySchema = z
  .object({
    total: z.number().int().min(0),
    succeeded: z.number().int().min(0),
    failed: z.number().int().min(0),
    deadLettered: z.number().int().min(0),
    pending: z
      .number()
      .int()
      .min(0)
      .meta({ description: "pending + in_progress for list summaries" }),
  })
  .meta({ id: "FanoutSummary" });

export type FanoutSummary = z.infer<typeof fanoutSummarySchema>;

/** Mirrors ADR 0007's `delivery_status` Postgres enum. */
export const deliveryStatusSchema = z.enum([
  "pending",
  "in_progress",
  "succeeded",
  "failed",
  "dead_lettered",
]);

export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>;

/**
 * Issue #84: that Endpoint's Delivery facts, present only when the list is
 * filtered by `endpointId` + `status=failed` — lets the UI render the cause
 * of a grouped failure without a second call per Broadcast.
 */
export const broadcastEndpointDeliverySchema = z
  .object({
    deliveryId: idSchema,
    status: deliveryStatusSchema,
    lastStatusCode: z.number().int().nullable(),
    lastDurationMs: z.number().int().nullable(),
    lastError: z.string().nullable(),
    attemptCount: z.number().int().min(0),
  })
  .meta({ id: "BroadcastEndpointDelivery" });

export type BroadcastEndpointDelivery = z.infer<typeof broadcastEndpointDeliverySchema>;

export const broadcastListItemSchema = z
  .object({
    id: idSchema,
    channelId: idSchema,
    receivedAt: dateTimeSchema,
    bodyPreview: z.string(),
    fanout: fanoutSummarySchema,
    delivery: broadcastEndpointDeliverySchema.optional(),
  })
  .meta({ id: "BroadcastListItem" });

export type BroadcastListItem = z.infer<typeof broadcastListItemSchema>;

export const broadcastListSchema = z
  .object({
    items: z.array(broadcastListItemSchema),
    nextCursor: z.string().nullable(),
  })
  .meta({ id: "BroadcastList" });

export type BroadcastList = z.infer<typeof broadcastListSchema>;

/**
 * Issue #84: `endpointId` + `status=failed` are additive and must arrive
 * together — narrows this Channel's Activity to the Broadcasts whose
 * Delivery to that one Endpoint failed or dead-lettered (`status: "failed"`
 * means both terminal failure states, the same pairing the failure roll-up
 * counts). Omitting
 * both leaves the existing unfiltered call's response unchanged.
 */
export const broadcastListQuerySchema = z
  .object({
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    endpointId: idSchema.optional(),
    status: z.enum(["failed"]).optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.endpointId !== undefined) !== (value.status !== undefined)) {
      ctx.addIssue({
        code: "custom",
        path: value.endpointId !== undefined ? ["status"] : ["endpointId"],
        message: "endpointId and status must be provided together",
      });
    }
  });

export type BroadcastListQuery = z.infer<typeof broadcastListQuerySchema>;

export const deliveryItemSchema = z
  .object({
    id: idSchema,
    endpointId: idSchema,
    endpointName: z.string().nullable(),
    endpointUrl: z.string(),
    status: deliveryStatusSchema,
    attemptCount: z.number().int().min(0),
    lastStatusCode: z.number().int().nullable(),
    lastDurationMs: z.number().int().nullable(),
    lastError: z.string().nullable(),
    updatedAt: dateTimeSchema,
  })
  .meta({ id: "DeliveryItem" });

export type DeliveryItem = z.infer<typeof deliveryItemSchema>;

/**
 * Broadcast detail (issue #19 AC): inbound payload plus every fanned-out
 * Delivery. `body` is a UTF-8 decode of the raw bytes — good enough for the
 * MVP demo's JSON/text payloads; binary bodies just render with replacement
 * characters rather than breaking the response.
 */
export const broadcastDetailSchema = z
  .object({
    id: idSchema,
    channelId: idSchema,
    receivedAt: dateTimeSchema,
    contentType: z.string(),
    body: z.string().meta({
      description: "Raw inbound body (UTF-8 text for MVP sketch)",
    }),
    deliveries: z.array(deliveryItemSchema),
  })
  .meta({ id: "BroadcastDetail" });

export type BroadcastDetail = z.infer<typeof broadcastDetailSchema>;

/**
 * `POST .../broadcasts/:broadcastId/replay` response (issue #22; mirrors
 * `docs/contracts/admin.openapi.yaml`'s `BroadcastAccepted`): replay accepts
 * a brand-new Broadcast built from the stored payload — same `{ id }` shape
 * as ingest's `202`, distinguishing it from an in-place resend of the
 * original Broadcast's Deliveries.
 */
export const broadcastReplayAcceptedSchema = z
  .object({
    id: idSchema.meta({ description: "New Broadcast id from replay" }),
  })
  .meta({ id: "BroadcastAccepted" });

export type BroadcastReplayAccepted = z.infer<typeof broadcastReplayAcceptedSchema>;
