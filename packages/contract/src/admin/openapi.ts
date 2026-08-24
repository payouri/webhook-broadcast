import { createDocument } from "zod-openapi";
import { broadcastsPaths } from "./paths/broadcasts.js";
import { channelFailuresPaths } from "./paths/channelFailures.js";
import { channelsPaths } from "./paths/channels.js";
import { deliveriesPaths } from "./paths/deliveries.js";
import { endpointsPaths } from "./paths/endpoints.js";
import { operatorTokensPaths } from "./paths/operatorTokens.js";
import { operatorSecurity } from "./paths/shared.js";
import { tokensPaths } from "./paths/tokens.js";

/**
 * Admin routes declared from Zod, one module per domain under `./paths/`
 * (see ADR 0012) — ingest is intentionally excluded (ADR 0005).
 */
export const adminOpenApiPaths = {
  ...channelsPaths,
  ...channelFailuresPaths,
  ...endpointsPaths,
  ...tokensPaths,
  ...operatorTokensPaths,
  ...broadcastsPaths,
  ...deliveriesPaths,
};

export function emitAdminOpenApiDocument() {
  return createDocument(
    {
      openapi: "3.1.0",
      info: {
        title: "webhook-broadcast Admin API",
        version: "0.1.0",
        description:
          "Operator-facing admin contract emitted from Zod schemas in packages/contract for Channel/Endpoint/Broadcast/Delivery administration.\n\n" +
          "`POST /ingest/{slug}` is deliberately NOT a path in this document (ADR 0005) — it authenticates with the Channel's own ingest token rather than an operator credential, accepts an arbitrary request body with no useful schema, and a generated `ingest()` client method typed `body: unknown` would be noise. It still exists and can be called: `POST /ingest/{slug}` with `Authorization: Bearer <channel ingest token>` (omit the header entirely when the Channel has opted into unauthenticated ingest), any request body relayed verbatim to every enabled Endpoint on that Channel, answering a 2xx on acceptance whose exact status defaults to `202` but is configurable service-wide via `INGEST_SUCCESS_STATUS` and per-Channel via `ingestSuccessStatus`. The accepted response carries the id of the new Broadcast, except under a configured `204`/`205`, which carry no body by HTTP rule. The linked documentation covers ingest in full.",
      },
      externalDocs: {
        description: "Ingest request/response shape and auth, documented in full",
        url: "https://github.com/payouri/webhook-broadcast/blob/trunk/CONTEXT.md",
      },
      servers: [{ url: "/" }],
      security: operatorSecurity,
      tags: [
        { name: "channels" },
        { name: "endpoints" },
        { name: "tokens" },
        { name: "operator-tokens" },
        { name: "broadcasts" },
        { name: "deliveries" },
      ],
      paths: adminOpenApiPaths,
      components: {
        securitySchemes: {
          OperatorBearer: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "API key",
            description:
              "The bootstrap OPERATOR_API_KEY, or any minted operator_token (issue #41) — both are accepted as Bearer credentials with equal privilege. Only the bootstrap key may also be exchanged for the dashboard's HttpOnly session cookie via POST /auth/login; the cookie itself is accepted here as an alternate to Bearer, not a separate OAuth/user session.",
          },
          OperatorCookie: {
            type: "apiKey",
            in: "cookie",
            name: "wb_operator",
            description: "Optional alternate to OperatorBearer for the dashboard.",
          },
        },
      },
    },
    { reused: "ref", cycles: "ref" },
  );
}
