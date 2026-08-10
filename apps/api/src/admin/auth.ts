import { timingSafeEqual } from "node:crypto";
import type { Context, Next } from "koa";
import { errorBody } from "@webhook-broadcast/contract";

export interface OperatorAuthConfig {
  operatorApiKey: string;
  cookieName: string;
}

function extractBearerToken(header: string | undefined): string | undefined {
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
 * Guards the admin surface: accepts `Authorization: Bearer <key>` or the
 * same key via the HttpOnly session cookie (ADR 0005). Rejections use the
 * shared error envelope so admin clients branch on `error.code`, not status
 * text.
 */
export function createOperatorAuthMiddleware(config: OperatorAuthConfig) {
  return async (ctx: Context, next: Next): Promise<void> => {
    const bearer = extractBearerToken(ctx.headers.authorization);
    const cookie = ctx.cookies.get(config.cookieName);
    const credential = bearer ?? cookie;

    if (!credential || !safeEqual(credential, config.operatorApiKey)) {
      ctx.status = 401;
      ctx.body = errorBody("unauthorized", "missing or invalid operator credentials");
      return;
    }

    await next();
  };
}
