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

/**
 * Ceiling on `timeoutMs`, justified against ADR 0003's delivery semantics
 * rather than picked arbitrarily. Retries back off from a 5s base up to a 1h
 * cap (`DEFAULT_DELIVERY_BACKOFF_MS` / `DEFAULT_DELIVERY_BACKOFF_MAX_MS` in
 * `packages/contract/src/env.ts`), and the worker's HTTP timeout defaults to
 * 10s but is overridable per Endpoint. A per-Endpoint timeout anywhere near
 * that 1h backoff cap would let a single slow request occupy a worker slot
 * for as long as the retry schedule ever waits between attempts — no longer
 * "one request's" problem but the fan-out's, since every other Delivery
 * queued behind it stalls too. The cap below is set at that same 1h value
 * (kept as its own literal, not an import, because `env.ts` is deliberately
 * excluded from this browser-shared entry point — see index.ts's comment).
 */
export const MAX_ENDPOINT_TIMEOUT_MS = 3_600_000;

/**
 * The floor is only "a timeout at all" — anything below 1ms is not a shorter
 * timeout, it is a request that can never complete. Exported alongside the cap
 * so the Endpoint form's number stepper can take both bounds from here instead
 * of restating either one.
 */
export const MIN_ENDPOINT_TIMEOUT_MS = 1;

/**
 * Every rule below carries its own message, for the reason stated on
 * {@link endpointHeadersSchema}: an operator reads these in the Endpoint form,
 * so none of them may fall through to Zod's own voice. `0` and `1.5` are both
 * reachable from a `type="number"` field, and unmessaged they would surface as
 * "Too small: expected number to be >=1" and "Invalid input: expected int,
 * received number" — the exact phrasing DESIGN.md §5 Fields — Error forbids.
 *
 * The ceiling itself is justified against ADR 0003's delivery semantics rather
 * than picked arbitrarily. Retries back off from a 5s base up to a 1h cap
 * (`DEFAULT_DELIVERY_BACKOFF_MS` / `DEFAULT_DELIVERY_BACKOFF_MAX_MS` in
 * `packages/contract/src/env.ts`), and the HTTP timeout defaults to 10s but is
 * overridable per Endpoint. A per-Endpoint timeout anywhere near that 1h
 * backoff cap would let one slow Attempt hold a delivery slot for as long as
 * the retry schedule ever waits between attempts — no longer one Attempt's
 * problem but the whole fan-out's, since every Delivery queued behind it
 * stalls too. The cap is that same 1h value, kept as its own literal rather
 * than imported because `env.ts` is deliberately excluded from this
 * browser-shared entry point (see index.ts's comment). ADR 0015 records the
 * decision and the migration behaviour for Endpoints already above it.
 */
const timeoutNotWholeMessage = "Timeout must be a whole number of milliseconds";
const timeoutTooSmallMessage = `Timeout must be at least ${MIN_ENDPOINT_TIMEOUT_MS}ms`;
const timeoutTooLargeMessage = `Timeout must be at most ${MAX_ENDPOINT_TIMEOUT_MS}ms (1h) — past that, one slow Attempt stalls the rest of the Channel's fan-out`;

export const endpointTimeoutMsSchema = z
  .number(timeoutNotWholeMessage)
  .int(timeoutNotWholeMessage)
  .min(MIN_ENDPOINT_TIMEOUT_MS, timeoutTooSmallMessage)
  .max(MAX_ENDPOINT_TIMEOUT_MS, timeoutTooLargeMessage);

export const endpointSchema = z
  .object({
    id: idSchema,
    channelId: idSchema,
    name: z.string().nullable(),
    url: endpointUrlSchema,
    timeoutMs: endpointTimeoutMsSchema.nullable(),
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
    timeoutMs: endpointTimeoutMsSchema.optional(),
    headers: endpointHeadersSchema.optional(),
    enabled: z.boolean().default(true),
  })
  .meta({ id: "EndpointCreate" });

export type EndpointCreate = z.infer<typeof endpointCreateSchema>;

export const endpointUpdateSchema = z
  .object({
    name: z.string().min(1).nullable().optional(),
    url: endpointUrlSchema.optional(),
    timeoutMs: endpointTimeoutMsSchema.nullable().optional(),
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
