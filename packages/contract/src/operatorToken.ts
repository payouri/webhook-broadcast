import { z } from "zod";
import { dateTimeSchema, idSchema } from "./channel.js";

const operatorTokenLabelSchema = z
  .string()
  .min(1)
  .max(200)
  .meta({ description: "Operator-chosen name identifying the holder, e.g. a CI job or laptop" });

export const operatorTokenSummarySchema = z
  .object({
    id: idSchema,
    label: operatorTokenLabelSchema,
    prefix: z
      .string()
      .meta({ description: "First 12 chars of the token — the `wbop_` wire prefix plus 7 of the secret — for recognition; never the full secret" }),
    createdAt: dateTimeSchema,
    lastUsedAt: dateTimeSchema.nullable(),
  })
  .meta({ id: "OperatorTokenSummary" });

export type OperatorTokenSummary = z.infer<typeof operatorTokenSummarySchema>;

export const operatorTokenCreateSchema = z
  .object({
    label: operatorTokenLabelSchema,
  })
  .meta({ id: "OperatorTokenCreate" });

export type OperatorTokenCreate = z.infer<typeof operatorTokenCreateSchema>;

export const operatorTokenCreatedSchema = z
  .object({
    id: idSchema,
    token: z.string().meta({ description: "Plaintext operator token — shown once" }),
    label: operatorTokenLabelSchema,
    createdAt: dateTimeSchema,
  })
  .meta({ id: "OperatorTokenCreated" });

export type OperatorTokenCreated = z.infer<typeof operatorTokenCreatedSchema>;

/**
 * Operator credentials are a handful per deployment — no paging for MVP, but
 * the collection envelope stays `{ items, nextCursor }` like every other
 * admin collection, with `nextCursor` pinned null (ADR 0005).
 */
export const operatorTokenListSchema = z
  .object({
    items: z.array(operatorTokenSummarySchema),
    nextCursor: z.string().nullable(),
  })
  .meta({ id: "OperatorTokenList" });

export type OperatorTokenList = z.infer<typeof operatorTokenListSchema>;
