import type { ZodOpenApiPathsObject } from "zod-openapi";
import {
  channelCreateSchema,
  channelListQuerySchema,
  channelListSchema,
  channelSchema,
  channelUpdateSchema,
} from "../../channel.js";
import { channelIdPath, errorResponse, operatorSecurity } from "./shared.js";

/** Admin routes for the `channels` domain (tag: "channels"). */
export const channelsPaths = {
  "/channels": {
    get: {
      operationId: "listChannels",
      summary: "List channels",
      tags: ["channels"],
      security: operatorSecurity,
      requestParams: { query: channelListQuerySchema },
      responses: {
        "200": {
          description: "OK",
          content: { "application/json": { schema: channelListSchema } },
        },
        default: errorResponse,
      },
    },
    post: {
      operationId: "createChannel",
      summary: "Create channel",
      tags: ["channels"],
      security: operatorSecurity,
      requestBody: {
        required: true,
        content: { "application/json": { schema: channelCreateSchema } },
      },
      responses: {
        "201": {
          description: "Created",
          content: { "application/json": { schema: channelSchema } },
        },
        default: errorResponse,
      },
    },
  },
  "/channels/{channelId}": {
    get: {
      operationId: "getChannel",
      tags: ["channels"],
      security: operatorSecurity,
      requestParams: { path: channelIdPath },
      responses: {
        "200": {
          description: "OK",
          content: { "application/json": { schema: channelSchema } },
        },
        default: errorResponse,
      },
    },
    patch: {
      operationId: "updateChannel",
      tags: ["channels"],
      security: operatorSecurity,
      requestParams: { path: channelIdPath },
      requestBody: {
        required: true,
        content: { "application/json": { schema: channelUpdateSchema } },
      },
      responses: {
        "200": {
          description: "OK",
          content: { "application/json": { schema: channelSchema } },
        },
        default: errorResponse,
      },
    },
    delete: {
      operationId: "deleteChannel",
      summary: "Soft-delete channel (sets deletedAt)",
      tags: ["channels"],
      security: operatorSecurity,
      requestParams: { path: channelIdPath },
      responses: {
        "204": { description: "Soft-deleted" },
        default: errorResponse,
      },
    },
  },
} satisfies ZodOpenApiPathsObject;
