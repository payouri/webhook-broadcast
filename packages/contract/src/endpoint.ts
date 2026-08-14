import { z } from "zod";
import { dateTimeSchema, idSchema } from "./channel.js";

/**
 * Exported (alongside {@link endpointUrlSchema}) because the admin API is not
 * the only thing that needs these rules: `apps/web` validates the URL and
 * Headers fields locally against these same schemas, which is what
 * DESIGN.md §5's Reward-Early-Punish-Late Rule asks for ("validates locally
 * against the contract schema"). A hand-written headers check in the browser
 * once accepted `{"a": 1}` — non-string values — which this schema rejects,
 * so the field passed input the server then 400'd.
 *
 * Both carry their own message, the way `channelSlugSchema` does, because
 * these messages are read by an operator: DESIGN.md §5 Fields — Error requires
 * one that "names the constraint in the system's own voice", never Zod's
 * default "Invalid URL" or "Invalid input: expected string, received number".
 * Stating it on the schema is what keeps the field and the admin API saying the
 * same sentence rather than two paraphrases of one rule.
 */
const headersMessage =
  'Headers must be a JSON object of string values (e.g. {"x-api-key": "secret"})';

export const endpointHeadersSchema = z.record(z.string(), z.string(headersMessage), headersMessage);

export const endpointUrlSchema = z.url(
  "URL must be a full URL including the scheme (e.g. https://example.com/webhook)",
);

export const endpointSchema = z
  .object({
    id: idSchema,
    channelId: idSchema,
    name: z.string().nullable(),
    url: endpointUrlSchema,
    timeoutMs: z.number().int().min(1).nullable(),
    headers: endpointHeadersSchema,
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
    url: endpointUrlSchema,
    timeoutMs: z.number().int().min(1).optional(),
    headers: endpointHeadersSchema.optional(),
    enabled: z.boolean().default(true),
  })
  .meta({ id: "EndpointCreate" });

export type EndpointCreate = z.infer<typeof endpointCreateSchema>;

export const endpointUpdateSchema = z
  .object({
    name: z.string().min(1).nullable().optional(),
    url: endpointUrlSchema.optional(),
    timeoutMs: z.number().int().min(1).nullable().optional(),
    headers: endpointHeadersSchema.optional(),
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
