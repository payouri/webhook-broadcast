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
    allowUnauthenticatedIngest: z.boolean().meta({
      description:
        "Issue #38: when true, POST /ingest/:slug accepts this Channel's events without an " +
        "ingest token — the slug is the only thing gating its fan-out. Off by default.",
    }),
    endpointCount: z.number().int().min(0),
    hasBroadcasts: z.boolean().meta({
      description:
        "Issue #44: whether this Channel has any retained Broadcast — ADR 0002's retention " +
        "window bounds this, so a Channel whose whole history has been swept reads as false " +
        "again. false distinguishes 'no activity' from a healthy Channel: a Channel with zero " +
        "recent failures because it has taken no traffic must not read the same as one that is " +
        "actually fine.",
    }),
    recentFailedDeliveryCount: z
      .number()
      .int()
      .min(0)
      .meta({
        description:
          "Issue #44: count of this Channel's `failed` + `dead_lettered` Deliveries within the " +
          "recent health window (packages/db's CHANNEL_RECENT_FAILURE_WINDOW_MS, currently 24h) " +
          "— the single window constant every layer defers to, computed in one grouped query per " +
          "list request rather than once per Channel.",
      }),
    autoDisabledEndpointCount: z
      .number()
      .int()
      .min(0)
      .meta({
        description:
          "Issue #45: how many of this Channel's Endpoints are currently auto-disabled (ADR " +
          "0003) — `autoDisabledAt IS NOT NULL`, cleared the moment an operator re-enables one. " +
          "An auto-disabled Endpoint is otherwise silent: the Channel keeps accepting Broadcasts " +
          "while fan-out to that target quietly stops, so this is surfaced on the directory row " +
          "rather than only on the Endpoints tab.",
      }),
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

/**
 * Mirrors the `channel_open_ingest_slug_length_chk` DB constraint
 * (`packages/db/src/schema.ts`) — kept as a literal here rather than an
 * import so `contract` (used by `web`) never depends on `db`. The DB check
 * is what actually enforces this; this copy only gives the admin API a
 * 400 instead of a 500 on violation.
 */
export const MIN_OPEN_INGEST_SLUG_LENGTH = 24;

function refineOpenIngestSlugLength<
  T extends { slug?: string | undefined; allowUnauthenticatedIngest?: boolean | undefined },
>(value: T, ctx: z.core.$RefinementCtx<T>): void {
  if (
    value.allowUnauthenticatedIngest &&
    value.slug !== undefined &&
    value.slug.length < MIN_OPEN_INGEST_SLUG_LENGTH
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["slug"],
      message: `slug must be at least ${MIN_OPEN_INGEST_SLUG_LENGTH} characters when allowUnauthenticatedIngest is true`,
    });
  }
}

export const channelCreateSchema = z
  .object({
    slug: slugSchema,
    description: z.string().optional(),
    enabled: z.boolean().default(true),
    forwardHeaders: forwardHeadersSchema.default([]),
    allowUnauthenticatedIngest: z.boolean().default(false),
  })
  .superRefine(refineOpenIngestSlugLength)
  .meta({ id: "ChannelCreate" });

export type ChannelCreate = z.infer<typeof channelCreateSchema>;

export const channelUpdateSchema = z
  .object({
    slug: slugSchema.optional(),
    description: z.string().nullable().optional(),
    enabled: z.boolean().optional(),
    forwardHeaders: forwardHeadersSchema.optional(),
    allowUnauthenticatedIngest: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one field must be provided",
  })
  .superRefine(refineOpenIngestSlugLength)
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
