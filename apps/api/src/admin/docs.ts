import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
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

interface DocRepresentation {
  body: string;
  etag: string;
}

/**
 * A doc route's body is produced on first use, then reused verbatim.
 *
 * The two contract representations are cheap and already in memory, but the
 * Scalar bundle is ~4 MB read off disk, and producing it eagerly would make
 * *constructing the app* depend on that file existing — so a pruned image
 * missing it, or a future release of the package moving it, would take down
 * the whole api rather than the one route that needs it, on a deployment that
 * may well have set `DOCS_ENABLED=false` precisely to opt out of all this.
 * Deferring the work keeps the blast radius of a missing docs asset inside
 * the docs routes, and keeps `DOCS_ENABLED=false` from paying for it at all.
 */
function representationLoader(load: () => string): () => DocRepresentation {
  let cached: DocRepresentation | undefined;
  return () => {
    if (cached === undefined) {
      const body = load();
      cached = { body, etag: etagOf(body) };
    }
    return cached;
  };
}

/**
 * `@scalar/api-reference`'s standalone browser bundle is loaded from its own
 * package directory on disk, the same pattern the api already relies on for
 * `bullmq` (see `apps/api/Dockerfile`): the file is never one of the
 * package's declared `exports` subpaths, so it has to be found by resolving
 * an entry point `exports` *does* list (`.`, `dist/index.js`) and walking up
 * to the package root from there, rather than importing it as a module.
 * `require.resolve` only resolves the path — it never loads or executes the
 * ESM-only package — so this works whether or not the running api process
 * could otherwise `require()` it.
 */
function resolveScalarStandaloneBundlePath(): string {
  const require = createRequire(import.meta.url);
  const entryPoint = require.resolve("@scalar/api-reference");
  const packageRoot = dirname(dirname(entryPoint)); // .../dist/index.js -> .../dist -> package root
  return join(packageRoot, "dist", "browser", "standalone.js");
}

/**
 * The `/docs` shell (issue #109): a small HTML string, not a template file —
 * this route is the whole reason `apps/api` gains no template/build step for
 * it. It fetches `/openapi.json` itself before booting the renderer so a
 * session that expired between page load and spec fetch shows a plain
 * sentence instead of an empty renderer around a console 401 (the fetch
 * result is discarded once it's known to be OK; `Scalar.createApiReference`
 * re-requests the same URL, which the browser serves from its HTTP cache /
 * revalidates via the `ETag` above, not a second real fetch in practice).
 */
function docsHtmlShell(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>API Reference</title>
  </head>
  <body>
    <div id="docs-root">Loading the API reference…</div>
    <script src="/docs/scalar.js"></script>
    <script>
      (function () {
        var root = document.getElementById("docs-root");
        fetch("/openapi.json", { credentials: "same-origin" })
          .then(function (response) {
            if (!response.ok) {
              root.textContent =
                "Your session has expired. Log in to the dashboard to view the API reference.";
              return;
            }
            root.textContent = "";
            window.Scalar.createApiReference("#docs-root", { url: "/openapi.json" });
          })
          .catch(function () {
            root.textContent =
              "Your session has expired. Log in to the dashboard to view the API reference.";
          });
      })();
    </script>
  </body>
</html>
`;
}

/**
 * Registers one representation of the admin contract on the admin router,
 * sharing the auth/`DOCS_ENABLED`/`ETag`/`no-cache` behaviour between
 * `/openapi.json` (issue #107), `/openapi.yaml` (issue #108) and `/docs`
 * (issue #109) so they differ only in which body they load and which content
 * type they send.
 */
function registerDocRoute(
  router: Router,
  path: string,
  config: DocsRouteConfig,
  load: () => string,
  contentType: string,
): void {
  const representation = representationLoader(load);

  router.get(path, (ctx) => {
    if (!config.docsEnabled) {
      ctx.status = 404;
      ctx.body = errorBody(
        "docs_disabled",
        "the OpenAPI document is disabled on this deployment (DOCS_ENABLED=false)",
      );
      return;
    }

    const { body, etag } = representation();

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

  registerDocRoute(router, "/openapi.json", config, () => documentJson, "application/json");
  registerDocRoute(router, "/openapi.yaml", config, () => documentYaml, "application/yaml");

  // `GET /docs` (issue #109): renders the admin contract in a browser via
  // Scalar's standalone bundle, gated by the same operator auth + DOCS_ENABLED
  // as the two representations above. `GET /docs/scalar.js` serves that
  // bundle from the single explicit on-disk path resolved above — no
  // static-directory middleware mounted over the package — read on first
  // request rather than at construction (see `representationLoader`).
  registerDocRoute(router, "/docs", config, docsHtmlShell, "text/html; charset=utf-8");
  registerDocRoute(
    router,
    "/docs/scalar.js",
    config,
    () => readFileSync(resolveScalarStandaloneBundlePath(), "utf8"),
    "application/javascript; charset=utf-8",
  );
}
