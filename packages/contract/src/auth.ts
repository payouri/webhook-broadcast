import { z } from "zod";

export const loginRequestSchema = z.object({
  apiKey: z.string().min(1),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const loginResponseSchema = z.object({
  ok: z.literal(true),
});

export type LoginResponse = z.infer<typeof loginResponseSchema>;
