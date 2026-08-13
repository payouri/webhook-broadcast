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

export const operatorSecurity = [{ OperatorBearer: [] as string[] }];

/** `{channelId}` — the Channel every channel-scoped domain hangs off. */
export const channelIdPath = z.object({ channelId: idSchema });
