import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { idSchema } from "../../channel.js";
import {
  operatorTokenCreateSchema,
  operatorTokenCreatedSchema,
  operatorTokenListSchema,
} from "../../operatorToken.js";
import { errorResponse, operatorSecurity } from "./shared.js";

const operatorTokenPath = z.object({ tokenId: idSchema });

/** Admin routes for operator tokens (tag: "operator-tokens"). */
export const operatorTokensPaths = {
  "/operator-tokens": {
    get: {
      operationId: "listOperatorTokens",
      summary: "List operator token summaries (issue #41)",
      tags: ["operator-tokens"],
      security: operatorSecurity,
      responses: {
        "200": {
          description: "OK",
          content: { "application/json": { schema: operatorTokenListSchema } },
        },
        default: errorResponse,
      },
    },
    post: {
      operationId: "createOperatorToken",
      summary: "Mint an operator token; plaintext returned once",
      tags: ["operator-tokens"],
      security: operatorSecurity,
      requestBody: {
        required: true,
        content: { "application/json": { schema: operatorTokenCreateSchema } },
      },
      responses: {
        "201": {
          description: "Created",
          content: { "application/json": { schema: operatorTokenCreatedSchema } },
        },
        default: errorResponse,
      },
    },
  },
  "/operator-tokens/{tokenId}": {
    delete: {
      operationId: "revokeOperatorToken",
      summary: "Revoke an operator token immediately, no redeploy required",
      tags: ["operator-tokens"],
      security: operatorSecurity,
      requestParams: { path: operatorTokenPath },
      responses: {
        "204": { description: "Revoked" },
        default: errorResponse,
      },
    },
  },
} satisfies ZodOpenApiPathsObject;
