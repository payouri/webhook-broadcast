import { z } from "zod";
import { dateTimeSchema, idSchema } from "./channel.js";

const headersSchema = z.record(z.string(), z.string());

export const endpointSchema = z.object({
  id: idSchema,
  channelId: idSchema,
  name: z.string().nullable(),
  url: z.url(),
  timeoutMs: z.number().int().min(1).nullable(),
  headers: headersSchema,
  enabled: z.boolean(),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
});

export type Endpoint = z.infer<typeof endpointSchema>;

export const endpointCreateSchema = z.object({
  name: z.string().min(1).optional(),
  url: z.url(),
  timeoutMs: z.number().int().min(1).optional(),
  headers: headersSchema.optional(),
  enabled: z.boolean().default(true),
});

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
  });

export type EndpointUpdate = z.infer<typeof endpointUpdateSchema>;

export const endpointListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type EndpointListQuery = z.infer<typeof endpointListQuerySchema>;

export const endpointListSchema = z.object({
  items: z.array(endpointSchema),
  nextCursor: z.string().nullable(),
});

export type EndpointList = z.infer<typeof endpointListSchema>;
