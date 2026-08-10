import { z } from "zod";

export const idSchema = z.uuid();
export const dateTimeSchema = z.iso.datetime();

export const channelTokenSummarySchema = z.object({
  id: idSchema,
  prefix: z.string(),
  createdAt: dateTimeSchema,
});

export const channelTokenCreatedSchema = z.object({
  id: idSchema,
  token: z.string(),
  createdAt: dateTimeSchema,
});

export type ChannelTokenCreated = z.infer<typeof channelTokenCreatedSchema>;

export const channelSchema = z.object({
  id: idSchema,
  slug: z.string().min(1),
  description: z.string().nullable(),
  enabled: z.boolean(),
  endpointCount: z.number().int().min(0),
  tokens: z.array(channelTokenSummarySchema),
  deletedAt: dateTimeSchema.nullable(),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
});

export type Channel = z.infer<typeof channelSchema>;

/** Slugs are ingest-path segments (`POST /ingest/:slug`): URL-safe, no spaces. */
const slugSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be lowercase kebab-case (a-z, 0-9, -)");

export const channelCreateSchema = z.object({
  slug: slugSchema,
  description: z.string().optional(),
  enabled: z.boolean().default(true),
});

export type ChannelCreate = z.infer<typeof channelCreateSchema>;

export const channelUpdateSchema = z
  .object({
    slug: slugSchema.optional(),
    description: z.string().nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one field must be provided",
  });

export type ChannelUpdate = z.infer<typeof channelUpdateSchema>;

export const channelListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type ChannelListQuery = z.infer<typeof channelListQuerySchema>;

export const channelListSchema = z.object({
  items: z.array(channelSchema),
  nextCursor: z.string().nullable(),
});

export type ChannelList = z.infer<typeof channelListSchema>;
