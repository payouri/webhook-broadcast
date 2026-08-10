import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** Per-dependency result for GET /ready (ADR 0008: Postgres + Redis). */
export const readinessCheckStatusSchema = z.enum(["ok", "fail"]);

export const readyResponseSchema = z.object({
  status: z.enum(["ok", "not_ready"]),
  checks: z.object({
    postgres: readinessCheckStatusSchema,
    redis: readinessCheckStatusSchema,
  }),
});

export type ReadyResponse = z.infer<typeof readyResponseSchema>;
