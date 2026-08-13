import { z } from "zod";

export const idSchema = z.uuid().meta({ id: "Id" });
export const dateTimeSchema = z.iso
  .datetime()
  .meta({ id: "DateTime", description: "ISO-8601; Zod wire type z.iso.datetime()" });

export const channelTokenSummarySchema = z
  .object({
    id: idSchema,
    prefix: z
      .string()
      .meta({ description: "First ~8 chars of the token for recognition; never full secret" }),
    createdAt: dateTimeSchema,
  })
  .meta({ id: "ChannelTokenSummary" });

export const channelTokenCreatedSchema = z
  .object({
    id: idSchema,
    token: z.string().meta({ description: "Plaintext ingest token — shown once" }),
    createdAt: dateTimeSchema,
  })
  .meta({ id: "ChannelTokenCreated" });

export type ChannelTokenCreated = z.infer<typeof channelTokenCreatedSchema>;

/**
 * Issue #37: an inbound header name a Channel may forward to its
 * Endpoints on delivery. "authorization" is refused here — that header
 * carries the Channel's own ingest token (ADR 0002), and forwarding it
 * would hand every fan-out Endpoint write access on the Channel.
 */
const forwardHeaderNameSchema = z
  .string()
  .min(1)
  .refine((name) => name.trim().toLowerCase() !== "authorization", {
    message:
      "authorization cannot be forwarded (it carries the Channel's ingest token, not a sender credential)",
  });

const forwardHeadersSchema = z.array(forwardHeaderNameSchema);

export const channelSchema = z
  .object({
    id: idSchema,
    slug: z.string().min(1),
    description: z.string().nullable(),
    enabled: z.boolean(),
    forwardHeaders: forwardHeadersSchema.meta({
      description:
        "Allow-listed inbound header names forwarded to every Endpoint on delivery. Empty by default.",
    }),
    endpointCount: z.number().int().min(0),
    tokens: z.array(channelTokenSummarySchema),
    deletedAt: dateTimeSchema.nullable(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .meta({ id: "Channel" });

export type Channel = z.infer<typeof channelSchema>;

/** Slugs are ingest-path segments (`POST /ingest/:slug`): URL-safe, no spaces. */
const slugSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be lowercase kebab-case (a-z, 0-9, -)");

export const channelCreateSchema = z
  .object({
    slug: slugSchema,
    description: z.string().optional(),
    enabled: z.boolean().default(true),
    forwardHeaders: forwardHeadersSchema.default([]),
  })
  .meta({ id: "ChannelCreate" });

export type ChannelCreate = z.infer<typeof channelCreateSchema>;

export const channelUpdateSchema = z
  .object({
    slug: slugSchema.optional(),
    description: z.string().nullable().optional(),
    enabled: z.boolean().optional(),
    forwardHeaders: forwardHeadersSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one field must be provided",
  })
  .meta({ id: "ChannelUpdate" });

export type ChannelUpdate = z.infer<typeof channelUpdateSchema>;

export const channelListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  slug: z
    .string()
    .optional()
    .meta({ description: "Exact match on channel.slug (UNIQUE) — at most one row" }),
});

export type ChannelListQuery = z.infer<typeof channelListQuerySchema>;

export const channelListSchema = z
  .object({
    items: z.array(channelSchema),
    nextCursor: z.string().nullable(),
  })
  .meta({ id: "ChannelList" });

export type ChannelList = z.infer<typeof channelListSchema>;
