import { createHash } from "node:crypto";
import type Router from "@koa/router";
import {
  emitAdminOpenApiDocument,
  errorBody,
  toCanonicalAdminOpenApiYaml,
} from "@webhook-broadcast/contract";

export interface DocsRouteConfig {
  docsEnabled: boolean;
}

/**
 * RFC 9110 §13.1.2: `If-None-Match` carries a *list* of validators and is
 * matched with the weak comparison function, so `W/"x"` matches `"x"`. Both
 * forms show up in practice — a reverse proxy that gzips this response
 * rewrites the strong validator it forwards to a weak one — and a verbatim
 * string comparison quietly stops returning `304` for them.
 *
 * Koa's own `ctx.fresh` is not usable here: it refuses to match whenever the
 * *request* carries `Cache-Control: no-cache`, which Node's `fetch` and a
 * browser hard-reload both send unconditionally. That header asks an
 * intermediary not to serve a cached copy; it does not ask the origin to stop
 * answering a conditional request, which is the whole point of the `ETag`.
 */
function ifNoneMatchMatches(header: string, etag: string): boolean {
  if (header.trim() === "*") return true;
  const strip = (value: string) => value.replace(/^W\//, "");
  const current = strip(etag);
  return header
    .split(",")
    .map((candidate) => strip(candidate.trim()))
    .some((candidate) => candidate !== "" && candidate === current);
}

function etagOf(body: string): string {
  return `"${createHash("sha256").update(body).digest("hex")}"`;
}

/**
 * Registers one representation of the admin contract on the admin router,
 * sharing the auth/`DOCS_ENABLED`/`ETag`/`no-cache` behaviour between
 * `/openapi.json` (issue #107) and `/openapi.yaml` (issue #108) so the two
 * differ only in which pre-serialized body and content type they send.
 */
function registerDocRoute(
  router: Router,
  path: string,
  config: DocsRouteConfig,
  body: string,
  contentType: string,
): void {
  const etag = etagOf(body);

  router.get(path, (ctx) => {
    if (!config.docsEnabled) {
      ctx.status = 404;
      ctx.body = errorBody(
        "docs_disabled",
        "the OpenAPI document is disabled on this deployment (DOCS_ENABLED=false)",
      );
      return;
    }

    // no-cache (not `public`): these are authenticated responses that may
    // pass through a shared proxy, and a redeploy with a changed contract
    // must be visible immediately, not served stale from a shared cache.
    ctx.set("Cache-Control", "no-cache");
    ctx.set("ETag", etag);
    const ifNoneMatch = ctx.get("If-None-Match");
    if (ifNoneMatch !== "" && ifNoneMatchMatches(ifNoneMatch, etag)) {
      ctx.status = 304;
      return;
    }
    ctx.status = 200;
    ctx.type = contentType;
    ctx.body = body;
  });
}

/**
 * `GET /openapi.json` (issue #107) and `GET /openapi.yaml` (issue #108) —
 * the admin contract re-emitted from the same Zod source as the committed
 * `docs/contracts/admin.openapi.yaml` sketch (ADR 0012), not read off disk:
 * the sketch isn't shipped in the runtime image, and re-emission from the
 * code that is actually running is the whole reason to serve this from a
 * deployment rather than trust the repo copy. Both representations are
 * derived from one in-memory document and serialized exactly once here, at
 * app construction — reused verbatim for every request, never re-emitted
 * per call. The YAML body goes through the contract package's own canonical
 * serializer (`toCanonicalAdminOpenApiYaml`) so its bytes match the sketch's
 * formatting conventions rather than whatever a fresh call to `yaml.stringify`
 * would default to.
 *
 * Mounted on the admin router, so both inherit operator auth like every
 * other admin route: every path this document describes already requires a
 * credential, so there's no legitimate unauthenticated reader for it either.
 *
 * Deliberately not among the paths `emitAdminOpenApiDocument()` itself
 * describes — a document served behind `DOCS_ENABLED` must not advertise a
 * path that 404s when the flag is off.
 */
export function registerDocsRoutes(router: Router, config: DocsRouteConfig): void {
  const document = emitAdminOpenApiDocument();
  const documentJson = JSON.stringify(document);
  const documentYaml = toCanonicalAdminOpenApiYaml(document);

  registerDocRoute(router, "/openapi.json", config, documentJson, "application/json");
  registerDocRoute(router, "/openapi.yaml", config, documentYaml, "application/yaml");
}
