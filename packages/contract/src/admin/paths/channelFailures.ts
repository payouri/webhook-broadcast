import type { ZodOpenApiPathsObject } from "zod-openapi";
import { channelFailureRollupSchema } from "../../channelFailureRollup.js";
import { channelIdPath, errorResponse, operatorSecurity } from "./shared.js";

/**
 * Admin route for the Channel-scoped failure roll-up (issue #84, tag:
 * "channels"): one ranked entry per Endpoint with a recent failure, feeding
 * the Channel Activity's "group failures by Endpoint" view.
 */
export const channelFailuresPaths = {
  "/channels/{channelId}/failures": {
    get: {
      operationId: "listChannelFailures",
      summary: "Ranked failure roll-up by Endpoint (24h window)",
      tags: ["channels"],
      security: operatorSecurity,
      requestParams: { path: channelIdPath },
      responses: {
        "200": {
          description: "OK",
          content: { "application/json": { schema: channelFailureRollupSchema } },
        },
        default: errorResponse,
      },
    },
  },
} satisfies ZodOpenApiPathsObject;
