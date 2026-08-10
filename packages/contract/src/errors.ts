import { z } from "zod";

/**
 * One shared error shape for every admin response (ADR 0005). `code` is a
 * stable machine string so dashboard/API clients can branch on it without
 * parsing `message`.
 */
export const errorEnvelopeSchema = z
  .object({
    error: z.object({
      code: z.string().meta({
        description:
          "Stable machine code (e.g. validation_failed, not_found, unauthorized, conflict)",
      }),
      message: z.string(),
      details: z
        .array(
          z.object({
            path: z.string(),
            message: z.string(),
          }),
        )
        .optional()
        .meta({ description: "Present for validation_failed (Zod issues)" }),
    }),
  })
  .meta({ id: "ErrorEnvelope" });

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export type ErrorCode =
  | "unauthorized"
  | "not_found"
  | "conflict"
  | "validation_failed"
  | "payload_too_large"
  | "internal_error"
  | "rate_limited";

export function errorBody(
  code: ErrorCode,
  message: string,
  details?: ErrorEnvelope["error"]["details"],
): ErrorEnvelope {
  return details === undefined
    ? { error: { code, message } }
    : { error: { code, message, details } };
}
