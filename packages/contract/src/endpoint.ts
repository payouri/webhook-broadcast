import { z } from "zod";
import { dateTimeSchema, idSchema } from "./channel.js";

const headersSchema = z.record(z.string(), z.string());

export const endpointSchema = z
  .object({
    id: idSchema,
    channelId: idSchema,
    name: z.string().nullable(),
    url: z.url(),
    timeoutMs: z.number().int().min(1).nullable(),
    headers: headersSchema,
    enabled: z.boolean(),
    autoDisabledAt: dateTimeSchema.nullable().optional(),
    successRate24h: z.number().min(0).max(1).nullable().optional(),
    p95Ms: z.number().int().nullable().optional(),
    lastSuccessAt: dateTimeSchema.nullable().optional(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .meta({ id: "Endpoint" });

export type Endpoint = z.infer<typeof endpointSchema>;

export const endpointCreateSchema = z
  .object({
    name: z.string().min(1).optional(),
    url: z.url(),
    timeoutMs: z.number().int().min(1).optional(),
    headers: headersSchema.optional(),
    enabled: z.boolean().default(true),
  })
  .meta({ id: "EndpointCreate" });

export type EndpointCreate = z.infer<typeof endpointCreateSchema>;

export const endpointUpdateSchema = z
  .object({
    name: z.string().min(1).nullable().optional(),
    url: z.url().optional(),
    timeoutMs: z.number().int().min(1).nullable().optional(),
    headers: headersSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one field must be provided",
  })
  .meta({ id: "EndpointUpdate" });

export type EndpointUpdate = z.infer<typeof endpointUpdateSchema>;

export const endpointListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  url: z.string().optional().meta({
    description: "Exact match on endpoint.url within this channel (UNIQUE) — at most one row",
  }),
});

export type EndpointListQuery = z.infer<typeof endpointListQuerySchema>;

export const endpointListSchema = z
  .object({
    items: z.array(endpointSchema),
    nextCursor: z.string().nullable(),
  })
  .meta({ id: "EndpointList" });

export type EndpointList = z.infer<typeof endpointListSchema>;
