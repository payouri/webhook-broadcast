import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

/**
 * /ready is stubbed until Postgres/Redis dependency checks land in a later
 * slice (see issue #15's acceptance criteria) — the shape is settled now so
 * the dashboard and ops tooling can integrate against it early.
 */
export const readyResponseSchema = z.object({
  status: z.literal("ok"),
  checks: z.object({}).catchall(z.never()).default({}),
});

export type ReadyResponse = z.infer<typeof readyResponseSchema>;
