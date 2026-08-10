import { z } from "zod";
import { createDocument, type ZodOpenApiResponsesObject } from "zod-openapi";
import {
  channelCreateSchema,
  channelListQuerySchema,
  channelListSchema,
  channelSchema,
  channelUpdateSchema,
  idSchema,
} from "../channel.js";
import { errorEnvelopeSchema } from "../errors.js";
import {
  endpointCreateSchema,
  endpointListQuerySchema,
  endpointListSchema,
  endpointSchema,
  endpointUpdateSchema,
} from "../endpoint.js";
import {
  broadcastDetailSchema,
  broadcastListQuerySchema,
  broadcastListSchema,
  broadcastReplayAcceptedSchema,
} from "../broadcast.js";
import { attemptListSchema, deliveryDetailSchema } from "../delivery.js";
import { channelTokenCreatedSchema } from "../channel.js";

const errorResponse: ZodOpenApiResponsesObject["default"] = {
  description: "Error",
  content: {
    "application/json": { schema: errorEnvelopeSchema },
  },
};

const operatorSecurity = [{ OperatorBearer: [] as string[] }];

const channelIdPath = z.object({ channelId: idSchema });
const channelEndpointPath = z.object({ channelId: idSchema, endpointId: idSchema });
const channelTokenPath = z.object({ channelId: idSchema, tokenId: idSchema });
const channelBroadcastPath = z.object({ channelId: idSchema, broadcastId: idSchema });
const deliveryIdPath = z.object({ deliveryId: idSchema });

/** Admin routes declared from Zod — ingest is intentionally excluded (ADR 0005). */
export const adminOpenApiPaths = {
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
  },
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
  "/deliveries/{deliveryId}": {
    get: {
      operationId: "getDelivery",
      tags: ["deliveries"],
      security: operatorSecurity,
      requestParams: { path: deliveryIdPath },
      responses: {
        "200": {
          description: "OK",
          content: { "application/json": { schema: deliveryDetailSchema } },
        },
        default: errorResponse,
      },
    },
  },
  "/deliveries/{deliveryId}/attempts": {
    get: {
      operationId: "listDeliveryAttempts",
      tags: ["deliveries"],
      security: operatorSecurity,
      requestParams: { path: deliveryIdPath },
      responses: {
        "200": {
          description: "OK",
          content: { "application/json": { schema: attemptListSchema } },
        },
        default: errorResponse,
      },
    },
  },
  "/deliveries/{deliveryId}/retry": {
    post: {
      operationId: "retryDelivery",
      summary: "Re-enqueue a dead_lettered Delivery (409 if not dead_lettered)",
      tags: ["deliveries"],
      security: operatorSecurity,
      requestParams: { path: deliveryIdPath },
      responses: {
        "200": {
          description: "Delivery re-queued as pending",
          content: { "application/json": { schema: deliveryDetailSchema } },
        },
        default: errorResponse,
      },
    },
  },
};

export function emitAdminOpenApiDocument() {
  return createDocument(
    {
      openapi: "3.1.0",
      info: {
        title: "webhook-broadcast Admin API",
        version: "0.1.0",
        description:
          "Operator-facing admin contract emitted from Zod schemas in packages/contract. Ingest `POST /ingest/{slug}` is intentionally NOT in this document.",
      },
      servers: [{ url: "/" }],
      security: operatorSecurity,
      tags: [
        { name: "channels" },
        { name: "endpoints" },
        { name: "tokens" },
        { name: "broadcasts" },
        { name: "deliveries" },
      ],
      paths: adminOpenApiPaths,
      components: {
        securitySchemes: {
          OperatorBearer: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "API key",
            description:
              "Operator API key. Dashboard may send the same key via HttpOnly cookie `wb_operator` instead; middleware accepts either. Cookie is not a separate OAuth/user session.",
          },
          OperatorCookie: {
            type: "apiKey",
            in: "cookie",
            name: "wb_operator",
            description: "Optional alternate to OperatorBearer for the dashboard.",
          },
        },
      },
    },
    { reused: "ref", cycles: "ref" },
  );
}
