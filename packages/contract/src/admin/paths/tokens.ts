import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { channelTokenCreatedSchema, idSchema } from "../../channel.js";
import { channelIdPath, errorResponse, operatorSecurity } from "./shared.js";

const channelTokenPath = z.object({ channelId: idSchema, tokenId: idSchema });

/** Admin routes for Channel-scoped ingest tokens (tag: "tokens"). */
export const tokensPaths = {
  "/channels/{channelId}/tokens": {
    post: {
      operationId: "createChannelToken",
      summary: "Create ingest token; plaintext returned once",
      tags: ["tokens"],
      security: operatorSecurity,
      requestParams: { path: channelIdPath },
      responses: {
        "201": {
          description: "Created",
          content: { "application/json": { schema: channelTokenCreatedSchema } },
        },
        default: errorResponse,
      },
    },
  },
  "/channels/{channelId}/tokens/{tokenId}": {
    delete: {
      operationId: "revokeChannelToken",
      tags: ["tokens"],
      security: operatorSecurity,
      requestParams: { path: channelTokenPath },
      responses: {
        "204": { description: "Revoked" },
        default: errorResponse,
      },
    },
  },
} satisfies ZodOpenApiPathsObject;
