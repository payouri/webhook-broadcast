import { timingSafeEqual } from "node:crypto";
import type { Context, Next } from "koa";
import { errorBody } from "@webhook-broadcast/contract";
import {
  findOperatorTokenByHash,
  touchOperatorTokenLastUsed,
  type Database,
} from "@webhook-broadcast/db";
import { hashToken } from "../tokens.js";

export interface OperatorAuthConfig {
  operatorApiKey: string;
  cookieName: string;
  db: Database;
}

/**
 * What the auth middleware writes onto `ctx.state` once a credential matches
 * (issue #41). `"bootstrap"` stands for `OPERATOR_API_KEY`; anything else is a
 * minted `operator_token`'s label. Never the credential value itself.
 */
export interface OperatorAuthState {
  operatorLabel: string;
}

/**
 * Reads back what the middleware stored. Koa types `ctx.state` as an open bag,
 * so this is the one place that narrows it — callers get a plain `string`
 * rather than `any`. Unreachable in practice: every request past the guard has
 * a label.
 */
export function operatorLabelOf(ctx: Context): string {
  const state = ctx.state as Partial<OperatorAuthState>;
  return state.operatorLabel ?? "unknown";
}

export function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) {
    return undefined;
  }
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return undefined;
  }
  return token;
}

/**
 * Constant-time compare regardless of length mismatch — a naive
 * `a.length === b.length` short-circuit leaks the secret length via timing.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, Buffer.alloc(bufA.length));
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Guards the admin surface. Two credential shapes, deliberately asymmetric
 * (issue #41):
 *   - The HttpOnly session cookie (ADR 0005) only ever carries the bootstrap
 *     `OPERATOR_API_KEY` — it is minted once at `/auth/login` and compared
 *     directly, never looked up against `operator_token`. Dashboard login
 *     stays the bootstrap credential's exclusive privilege.
 *   - `Authorization: Bearer` accepts either the bootstrap key or any
 *     unrevoked `operator_token` (hashed at rest, mirroring `channel_token`).
 *     Minted operator tokens are bearer-only: they authenticate the API but
 *     cannot log into the dashboard.
 * Rejections use the shared error envelope so admin clients branch on
 * `error.code`, not status text.
 */
export function createOperatorAuthMiddleware(config: OperatorAuthConfig) {
  return async (ctx: Context, next: Next): Promise<void> => {
    const setLabel = (label: string): void => {
      (ctx.state as OperatorAuthState).operatorLabel = label;
    };
    const bearer = extractBearerToken(ctx.headers.authorization);
    if (bearer !== undefined) {
      if (safeEqual(bearer, config.operatorApiKey)) {
        setLabel("bootstrap");
        await next();
        return;
      }
      const row = await findOperatorTokenByHash(config.db, hashToken(bearer));
      if (row) {
        setLabel(row.label);
        // Fire-and-forget: a lastUsedAt write must never gate the request.
        void touchOperatorTokenLastUsed(config.db, row.id, new Date()).catch((error: unknown) => {
          console.error(
            JSON.stringify({
              msg: "operator token lastUsedAt update failed",
              error: String(error),
            }),
          );
        });
        await next();
        return;
      }
    } else {
      const cookie = ctx.cookies.get(config.cookieName);
      if (cookie !== undefined && safeEqual(cookie, config.operatorApiKey)) {
        setLabel("bootstrap");
        await next();
        return;
      }
    }

    ctx.status = 401;
    ctx.body = errorBody("unauthorized", "missing or invalid operator credentials");
  };
}
