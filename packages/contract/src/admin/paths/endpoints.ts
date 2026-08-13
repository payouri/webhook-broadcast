import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { idSchema } from "../../channel.js";
import {
  endpointCreateSchema,
  endpointListQuerySchema,
  endpointListSchema,
  endpointSchema,
  endpointUpdateSchema,
} from "../../endpoint.js";
import { channelIdPath, errorResponse, operatorSecurity } from "./shared.js";

const channelEndpointPath = z.object({ channelId: idSchema, endpointId: idSchema });

/** Admin routes for the `endpoints` domain (tag: "endpoints"). */
export const endpointsPaths = {
  "/channels/{channelId}/endpoints": {
    get: {
      operationId: "listEndpoints",
      tags: ["endpoints"],
      security: operatorSecurity,
      requestParams: { path: channelIdPath, query: endpointListQuerySchema },
      responses: {
        "200": {
          description: "OK",
          content: { "application/json": { schema: endpointListSchema } },
        },
        default: errorResponse,
      },
    },
    post: {
      operationId: "createEndpoint",
      tags: ["endpoints"],
      security: operatorSecurity,
      requestParams: { path: channelIdPath },
      requestBody: {
        required: true,
        content: { "application/json": { schema: endpointCreateSchema } },
      },
      responses: {
        "201": {
          description: "Created",
          content: { "application/json": { schema: endpointSchema } },
        },
        default: errorResponse,
      },
    },
  },
  "/channels/{channelId}/endpoints/{endpointId}": {
    get: {
      operationId: "getEndpoint",
      tags: ["endpoints"],
      security: operatorSecurity,
      requestParams: { path: channelEndpointPath },
      responses: {
        "200": {
          description: "OK",
          content: { "application/json": { schema: endpointSchema } },
        },
        default: errorResponse,
      },
    },
    patch: {
      operationId: "updateEndpoint",
      tags: ["endpoints"],
      security: operatorSecurity,
      requestParams: { path: channelEndpointPath },
      requestBody: {
        required: true,
        content: { "application/json": { schema: endpointUpdateSchema } },
      },
      responses: {
        "200": {
          description: "OK",
          content: { "application/json": { schema: endpointSchema } },
        },
        default: errorResponse,
      },
    },
    delete: {
      operationId: "deleteEndpoint",
      summary: "Hard-delete endpoint, freeing its (channelId, url)",
      tags: ["endpoints"],
      security: operatorSecurity,
      requestParams: { path: channelEndpointPath },
      responses: {
        "204": { description: "Deleted" },
        default: errorResponse,
      },
    },
  },
} satisfies ZodOpenApiPathsObject;
