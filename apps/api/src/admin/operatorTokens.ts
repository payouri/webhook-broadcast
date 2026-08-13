import { randomUUID } from "node:crypto";
import type Router from "@koa/router";
import {
  errorBody,
  operatorTokenCreateSchema,
  type OperatorTokenCreated,
  type OperatorTokenList,
} from "@webhook-broadcast/contract";
import {
  insertOperatorToken,
  listOperatorTokens,
  revokeOperatorToken,
  type Database,
} from "@webhook-broadcast/db";
import { mintOperatorToken } from "../tokens.js";
import { requireUuidParam, toDetails } from "./validation.js";

/**
 * Mint/list/revoke for operator credentials (issue #41). Every credential —
 * bootstrap `OPERATOR_API_KEY` or a minted token here — is fully privileged;
 * this is not per-Channel scoping, only "more than one holder at a time".
 */
export function registerOperatorTokenRoutes(router: Router, db: Database): void {
  router.get("/operator-tokens", async (ctx) => {
    const rows = await listOperatorTokens(db);
    const body: OperatorTokenList = {
      items: rows.map((row) => ({
        id: row.id,
        label: row.label,
        prefix: row.prefix,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
      })),
      nextCursor: null,
    };
    ctx.status = 200;
    ctx.body = body;
  });

  router.post("/operator-tokens", async (ctx) => {
    const parsedBody = operatorTokenCreateSchema.safeParse(ctx.request.body);
    if (!parsedBody.success) {
      ctx.status = 400;
      ctx.body = errorBody(
        "validation_failed",
        "invalid operator token payload",
        toDetails(parsedBody.error),
      );
      return;
    }

    const minted = mintOperatorToken();
    const row = await insertOperatorToken(db, {
      id: randomUUID(),
      tokenHash: minted.tokenHash,
      prefix: minted.prefix,
      label: parsedBody.data.label,
      createdAt: new Date(),
    });

    const body: OperatorTokenCreated = {
      id: row.id,
      token: minted.token,
      label: row.label,
      createdAt: row.createdAt.toISOString(),
    };
    ctx.status = 201;
    ctx.body = body;
  });

  router.delete("/operator-tokens/:tokenId", async (ctx) => {
    const tokenId = requireUuidParam(ctx, "tokenId");
    if (!tokenId) {
      return;
    }

    const revoked = await revokeOperatorToken(db, tokenId);
    if (!revoked) {
      ctx.status = 404;
      ctx.body = errorBody("not_found", "operator token not found");
      return;
    }
    ctx.status = 204;
  });
}
