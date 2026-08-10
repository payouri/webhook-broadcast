import type { Context } from "koa";
import type { z } from "zod";
import { errorBody, idSchema, type ErrorEnvelope } from "@webhook-broadcast/contract";

export function toDetails(error: z.ZodError): NonNullable<ErrorEnvelope["error"]["details"]> {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

/**
 * Validates a UUID path param, writing a 400 error envelope and returning
 * `undefined` on failure so callers can `if (!id) return;` instead of
 * threading a validation result through every handler.
 */
export function requireUuidParam(ctx: Context, name: string): string | undefined {
  const value = ctx.params[name];
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) {
    ctx.status = 400;
    ctx.body = errorBody("validation_failed", `${name} must be a UUID`);
    return undefined;
  }
  return parsed.data;
}
