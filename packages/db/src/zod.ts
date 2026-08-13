import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import {
  attempts,
  broadcasts,
  channels,
  channelTokens,
  deliveries,
  deliveryStatus,
  endpoints,
  operatorTokens,
} from "./schema.js";

/**
 * Issue #32: `drizzle-zod`-generated Zod schemas for the Drizzle tables that
 * back the admin/ingest contracts (`packages/contract`'s Channel, Endpoint,
 * Broadcast, Delivery, Attempt). These are the single source of truth for
 * "what shape does this column have" — a `packages/db/test` alignment check
 * parses fixture rows through both this schema and the corresponding
 * `packages/contract` schema, so renaming, retyping, or dropping a Drizzle
 * column that's part of the published contract fails that test (and, via
 * the inferred types below, `tsc`) instead of drifting silently.
 *
 * `contract` itself must not import from here: it's bundled into `apps/web`,
 * and this module's dependency chain (`drizzle-orm`, `pg`) is Node-only.
 * `packages/db/test` is the one place allowed to see both sides.
 *
 * A handful of columns need an explicit override because `createSelectSchema`
 * can't infer a JSON/custom-type column's shape from SQL type alone:
 * - `jsonb` columns carry their real shape only in Drizzle's `$type<...>()`,
 *   which `drizzle-zod` doesn't read.
 * - `body` is the hand-rolled `bytea` `customType` from `schema.ts`.
 */
export const channelRowSchema = createSelectSchema(channels, {
  forwardHeaders: z.array(z.string()),
});
export type ChannelZodRow = z.infer<typeof channelRowSchema>;

export const channelTokenRowSchema = createSelectSchema(channelTokens);
export type ChannelTokenZodRow = z.infer<typeof channelTokenRowSchema>;

export const operatorTokenRowSchema = createSelectSchema(operatorTokens);
export type OperatorTokenZodRow = z.infer<typeof operatorTokenRowSchema>;

export const endpointRowSchema = createSelectSchema(endpoints, {
  headers: z.record(z.string(), z.string()),
});
export type EndpointZodRow = z.infer<typeof endpointRowSchema>;

export const broadcastRowSchema = createSelectSchema(broadcasts, {
  body: z.instanceof(Buffer),
  headers: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
});
export type BroadcastZodRow = z.infer<typeof broadcastRowSchema>;

export const deliveryRowSchema = createSelectSchema(deliveries);
export type DeliveryZodRow = z.infer<typeof deliveryRowSchema>;

export const attemptRowSchema = createSelectSchema(attempts);
export type AttemptZodRow = z.infer<typeof attemptRowSchema>;

/** `delivery.status`'s Postgres enum, mirrored as a standalone Zod enum for reuse in checks. */
export const deliveryStatusSchema = createSelectSchema(deliveryStatus);
export type DeliveryStatusZod = z.infer<typeof deliveryStatusSchema>;
