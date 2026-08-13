import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { idSchema } from "../../channel.js";
import { attemptListSchema, deliveryDetailSchema } from "../../delivery.js";
import { errorResponse, operatorSecurity } from "./shared.js";

const deliveryIdPath = z.object({ deliveryId: idSchema });

/** Admin routes for Deliveries (tag: "deliveries"). */
export const deliveriesPaths = {
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
} satisfies ZodOpenApiPathsObject;
