import { z } from "zod";
import { idSchema } from "./channel.js";

/**
 * `POST /ingest/:slug` response shape. Deliberately not part of
 * `docs/contracts/admin.openapi.yaml` (ADR 0005) — ingest is Channel-token
 * auth, not the operator admin surface — but the shape is still shared
 * between the API and any future sender-side tooling.
 */
export const ingestAcceptedSchema = z.object({
  id: idSchema,
});

export type IngestAccepted = z.infer<typeof ingestAcceptedSchema>;
