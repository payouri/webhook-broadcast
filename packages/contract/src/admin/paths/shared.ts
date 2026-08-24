import { z } from "zod";
import type { ZodOpenApiResponsesObject } from "zod-openapi";
import { errorEnvelopeSchema } from "../../errors.js";
import { idSchema } from "../../channel.js";

/**
 * Building blocks genuinely shared by more than one admin path module in this
 * directory. Path-param schemas used by a single domain live in that domain's
 * module instead (ADR 0012).
 */

export const errorResponse: NonNullable<ZodOpenApiResponsesObject["default"]> = {
  description: "Error",
  content: {
    "application/json": { schema: errorEnvelopeSchema },
  },
};

/**
 * Either credential satisfies an admin operation, matching what the operator
 * middleware actually accepts: a Bearer token, or the dashboard's HttpOnly
 * session cookie. Declaring only bearer here left `OperatorCookie` defined but
 * unreferenced, so every spec reader and the generated client concluded the
 * cookie does not work.
 */
export const operatorSecurity = [
  { OperatorBearer: [] as string[] },
  { OperatorCookie: [] as string[] },
];

/** `{channelId}` — the Channel every channel-scoped domain hangs off. */
export const channelIdPath = z.object({ channelId: idSchema });
