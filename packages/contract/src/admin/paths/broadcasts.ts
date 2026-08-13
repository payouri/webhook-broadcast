import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import {
  broadcastDetailSchema,
  broadcastListQuerySchema,
  broadcastListSchema,
  broadcastReplayAcceptedSchema,
} from "../../broadcast.js";
import { idSchema } from "../../channel.js";
import { channelIdPath, errorResponse, operatorSecurity } from "./shared.js";

const channelBroadcastPath = z.object({ channelId: idSchema, broadcastId: idSchema });

/** Admin routes for Channel-scoped Broadcasts (tag: "broadcasts"). */
export const broadcastsPaths = {
  "/channels/{channelId}/broadcasts": {
    get: {
      operationId: "listChannelBroadcasts",
      summary: "Channel activity (newest first)",
      tags: ["broadcasts"],
      security: operatorSecurity,
      requestParams: { path: channelIdPath, query: broadcastListQuerySchema },
      responses: {
        "200": {
          description: "OK",
          content: { "application/json": { schema: broadcastListSchema } },
        },
        default: errorResponse,
      },
    },
  },
  "/channels/{channelId}/broadcasts/{broadcastId}": {
    get: {
      operationId: "getBroadcastDetail",
      summary: "Broadcast detail with fanned-out Deliveries",
      tags: ["broadcasts"],
      security: operatorSecurity,
      requestParams: { path: channelBroadcastPath },
      responses: {
        "200": {
          description: "OK",
          content: { "application/json": { schema: broadcastDetailSchema } },
        },
        default: errorResponse,
      },
    },
  },
  "/channels/{channelId}/broadcasts/{broadcastId}/replay": {
    post: {
      operationId: "replayBroadcast",
      summary: "Accept a new Broadcast from stored payload (202 semantics)",
      tags: ["broadcasts"],
      security: operatorSecurity,
      requestParams: { path: channelBroadcastPath },
      responses: {
        "202": {
          description: "Accepted",
          content: { "application/json": { schema: broadcastReplayAcceptedSchema } },
        },
        default: errorResponse,
      },
    },
  },
} satisfies ZodOpenApiPathsObject;
