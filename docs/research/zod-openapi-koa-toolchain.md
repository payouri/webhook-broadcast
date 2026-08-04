# Zod → OpenAPI toolchain for Koa, and typed-client generation

Research for [issue #4](https://github.com/payouri/webhook-broadcast/issues/4) (part of the map, [#1](https://github.com/payouri/webhook-broadcast/issues/1)).

Investigated **2026-08-04**. Every version number and publish date below was read on that date from
the npm registry API (`https://registry.npmjs.org/<pkg>/latest` for manifests,
`https://registry.npmjs.org/<pkg>` for the `time` map, `https://api.npmjs.org/downloads/point/...`
for download counts) or from the project's own source files and official docs site. No secondary
write-ups were used.

The code-first direction is already settled by the map: Zod schemas are the single source of truth,
the OpenAPI document is emitted from them, and a typed client is generated from the emitted spec.
This note picks the tools and names the sharp edges.

---

## TL;DR — recommended toolchain

| Layer | Pick | Version (2026-08-04) |
|---|---|---|
| Schema language | **Zod 4** | `zod@4.4.3` |
| OpenAPI emitter | **`zod-openapi`** | `zod-openapi@6.0.0` |
| Koa integration | **thin in-house wrapper** (no credible off-the-shelf option exists) | — |
| Emitted spec version | **OpenAPI 3.1.0**, committed to the repo | — |
| Client generator | **`openapi-typescript` + `openapi-fetch` + `openapi-react-query`** | `7.13.0` / `0.17.0` / `0.5.4` |
| Doc-serving UI | **Scalar**, served as HTML from Koa ourselves | `@scalar/api-reference@1.64.0` |
| Frontend query layer | `@tanstack/react-query` | `5.101.4` |

The one genuinely bad piece of news is in §3: **Koa has no router that validates with Zod and
registers the route into the OpenAPI document from one declaration.** That glue has to be written
in-house, and it is the single highest-risk part of the code-first decision.

---

## 1. Baseline: what Zod 4 already does by itself

This matters because it changes what an "emitter" is even for.

- **Zod 4 ships native JSON Schema conversion.** `z.toJSONSchema()` was
  "Introduced in `zod@4.0`" — [zod docs source, `json-schema.mdx`](https://github.com/colinhacks/zod/blob/main/packages/docs/content/json-schema.mdx).
- It accepts a `target` of `"draft-2020-12"` (default), `"draft-07"`, `"draft-04"`, or
  **`"openapi-3.0"`** — i.e. Zod itself knows about the OpenAPI 3.0 schema dialect (same source).
- Options relevant to a real API document: `metadata` (a registry; any schema with an `id` is
  extracted as a `$def`), `unrepresentable: "throw" | "any"`, `cycles: "ref" | "throw"`,
  `reused: "ref" | "inline"`, and **`io: "input" | "output"`** — "By default, the result of
  `z.toJSONSchema` represents the *output type*; use `"io": "input"` to extract the input type
  instead" (same source).
- **`z.file()` already emits an OpenAPI-friendly shape**:
  `z.file()` → `{ type: "string", format: "binary", contentEncoding: "binary" }`, and
  `z.file().min(1).max(1024*1024).mime("image/png")` adds `contentMediaType: "image/png"`
  (same source, "File schemas").
- **`z.date()` is explicitly unrepresentable** and throws by default, along`z.bigint()`,
  along with `z.bigint()`,
  `z.int64()`, `z.symbol()`, `z.undefined()`, `z.void()`, `z.map()`, `z.set()`, `z.transform()`,
  `z.nan()`, `z.custom()` (same source). The docs' own workaround is an `override` hook that rewrites
  `def.type === "date"` to `{ type: "string", format: "date-time" }`.
- Metadata lives in registries; `.meta()` is "a convenience method for registering a schema in
  `z.globalRegistry`" (same source).

**Consequence for us:** `z.date()` must not appear in any schema on the wire. Use
`z.iso.datetime()` (→ `{ type: "string", format: "date-time" }`, per the same doc) for
`broadcasts.created_at`, attempt timestamps, and every other timestamp in the admin contract. That
is a domain-model constraint falling out of the emitter choice, not a cosmetic one.

What an emitter adds on top of `z.toJSONSchema()` is the *document*: paths, operations, parameters,
request bodies, responses, `#/components/schemas` refs, security schemes.

- `zod@4.4.3` is `latest`, published **2026-05-04** (npm dist-tags + `time` map). Zod 4.0.0 was
  published **2025-07-09**; the 4.x line has
  shipped steadily since (4.1.0 2025-08-23, 4.2.0 2025-12-15, 4.3.0 2025-12-31).

---

## 2. OpenAPI emitters from Zod

Two live candidates. **Both require Zod 4** — this was the open question on the ticket, and the
answer is that Zod 4 is now the *only* supported major on the current release of each.

### 2.1 `zod-openapi` (samchungy)

- **`zod-openapi@6.0.0`**, published **2026-06-14**
  ([registry](https://registry.npmjs.org/zod-openapi/latest)). MIT.
  Repo `samchungy/zod-openapi`: 634 stars, `pushed_at` 2026-06-14
  ([GitHub API](https://api.github.com/repos/samchungy/zod-openapi)). ~1.05M downloads/week
  (`https://api.npmjs.org/downloads/point/last-week/zod-openapi`, 2026-07-28→2026-08-03).
- **`peerDependencies: { "zod": "^4.0.0" }`**, `engines: { node: ">=22.14.0" }` (manifest).
  The 6.0.0 changelog entry is explicit: *"Drop Zod 3 support and Node 20 support. The minimum
  supported Zod version is now 4.0.0. The minimum supported Node version is now 22.14.0."*
  ([CHANGELOG.md](https://github.com/samchungy/zod-openapi/blob/master/CHANGELOG.md)).
- **OpenAPI versions: 3.0.0 → 3.2.0.** Read from source, not the README — `src/openapi.ts` declares
  `openApiVersions = ['3.0.0','3.0.1','3.0.2','3.0.3','3.1.0','3.1.1','3.2.0']`
  ([src/openapi.ts](https://github.com/samchungy/zod-openapi/blob/master/src/openapi.ts)).
  6.0.0's headline change is *"Add OpenAPI 3.2.0 support"*, and it now returns
  `oas32.OpenAPIObject` instead of `oas31.OpenAPIObject` (CHANGELOG).
  ⚠️ **The README's "Supported OpenAPI Versions" section is stale** — it claims `3.1.0 (minimum
  version)` and `3.1.1` only, while immediately showing a 3.0.0-vs-3.1.0 rendering comparison. Trust
  `src/openapi.ts`.
- **No monkey-patching.** *"Use Zod's native `.meta()` method to add OpenAPI metadata… This library
  leverages Zod's built-in metadata functionality - no monkey patching or additional setup is
  required."* ([README](https://github.com/samchungy/zod-openapi/blob/master/README.md)). Type
  support for the extra `.meta()` keys comes from importing the package or a
  `/// <reference types="zod-openapi" />`.
- **It delegates to Zod's own converter.** `src/create/schema/schema.ts` imports `toJSONSchema` from
  Zod and calls it with `unrepresentable: 'any'`, the caller's `io`, `reused`, `cycles`, and a
  `target` derived from the requested OpenAPI version
  ([source](https://github.com/samchungy/zod-openapi/blob/master/src/create/schema/schema.ts)).
  This is the key architectural fact: **new Zod types are supported the day Zod supports them**,
  because there is no per-type transformer table to fall behind. The flip side is that Zod's
  unrepresentable list (§1) is inherited verbatim.
- **`$ref`s / reusable components**: `.meta({ id: 'jobId' })` promotes a schema into
  `#/components/schemas/jobId` and every use site becomes `{ "$ref": "#/components/schemas/jobId" }`
  (README, `createDocument` example). Components can alternatively be registered directly via
  `components: { schemas: {...} }`. The same `id` mechanism exists for parameters, headers,
  responses, callbacks and path items. `createSchema` supports `schemaComponentRefPath` for a custom
  ref prefix.
- **Input/output divergence is first-class**: `io: 'input' | 'output'` on `CreateDocumentOptions`,
  plus `.meta({ outputId: 'MyObjectResponse' })` to give the response variant of a schema its own
  component name, and a global output-suffix option (README).
- **Discriminated unions**: handled by Zod's converter; the README notes that OpenAPI
  `discriminator` mapping requires every member of the union to be a ref, which is what
  `.meta({ id })` gives you. Historical wrinkle worth knowing: 5.4.4 shipped *"Fix crash when
  generating discriminated union schemas with Zod 4.1.13+"* and 5.4.6 *"Address Zod 4.3+ 'cannot be
  represented in OpenAPI' compatibility issues"* (CHANGELOG) — i.e. **the emitter tracks Zod
  patch-level changes, so pin both and upgrade them together.**
- Cycles default to `'ref'`; reused schemas default to `'inline'` (README, `CreateDocumentOptions`).
  For a diffable committed spec, set `reused: 'ref'` so shared shapes stop being duplicated inline.

### 2.2 `@asteasolutions/zod-to-openapi`

- **`@asteasolutions/zod-to-openapi@9.1.0`**, published **2026-07-19**
  ([registry](https://registry.npmjs.org/@asteasolutions/zod-to-openapi/latest)). MIT. 9.0.0 landed
  2026-07-14, so this line is under active development. Repo `asteasolutions/zod-to-openapi`:
  1604 stars, `pushed_at` 2026-07-19, 33 open issues
  ([GitHub API](https://api.github.com/repos/asteasolutions/zod-to-openapi)). ~3.55M downloads/week
  — roughly 3.4× `zod-openapi`.
- **`peerDependencies: { "zod": "^4.0.0" }`** (manifest). Its README is blunt about the old line:
  *"For Zod v3 support, please use the v7.3.4 version. However keep in mind that we do not intend to
  actively support that version going forward"*
  ([README](https://github.com/asteasolutions/zod-to-openapi/blob/master/README.md)).
- **OpenAPI 3.0 / 3.1 / 3.2** via three generators, `OpenApiGeneratorV3`, `OpenApiGeneratorV31`,
  `OpenApiGeneratorV32`; *"`OpenApiGeneratorV32` uses the same JSON Schema dialect as 3.1 (2020-12),
  so schemas are generated identically"* (README).
- **It has a route registry, which `zod-openapi` does not.** `OpenAPIRegistry` collects definitions
  and `registry.registerPath({ method, path, request, responses })` / `registerWebhook()` records
  operations; `generator.generateDocument(config)` emits the document (README, "The Registry").
  This is the natural collection point for a framework binding — and is exactly what
  `@hono/zod-openapi` builds on (§3.3).
- **It maintains its own transformer table**, not Zod's converter: `src/transformers/` contains
  hand-written `date.ts`, `discriminated-union.ts`, `string.ts`, `template-literal.ts`, etc.
  ([source tree](https://github.com/asteasolutions/zod-to-openapi/tree/master/src/transformers)).
  Consequences, both directions:
  - **`ZodDate` is listed as a supported type** (README, "Supported types") — so `z.date()` works
    here where it throws in Zod's own converter. Likewise `ZodEffects`, `ZodPipeline`, `ZodBigInt`,
    `ZodNativeEnum`, `ZodReadonly`, `ZodPrefault`.
  - Anything *not* in that table raises **`UnknownZodTypeError`** (README, "Unsupported types") —
    you must hand-register a `type` via `.openapi()`. So the emitter can lag Zod releases.
  - Discriminated unions get `discriminator` mapping *"when all Zod objects in the union are
    registered with `.register()` or contain a `refId`"* (README).
  - Documented known issue: *"`z.nullable(schema)` does not generate a `$ref` for underlying
    registered schemas"* — use `schema.nullable()` instead (README, linking
    [issue #141](https://github.com/asteasolutions/zod-to-openapi/issues/141)).
- **Monkey-patching is still the primary API.** `.openapi()` requires calling
  `extendZodWithOpenApi` once, and the README concedes the awkwardness: *"This should be done only
  once in a common-entrypoint file… If you're using tree-shaking with Webpack, mark that file as
  having side-effects. It can be bit tricky to achieve this in your codebase, because *require* is
  synchronous and *import* is a async."* Since v8 it also reads Zod's native `.meta()`, and the
  README says you can *"generate a schema without using `extendZodWithOpenApi`… and only rely on
  `.meta`"* — but two named scenarios still need `.openapi()`: extending an already-registered
  schema so the child uses `anyOf`, and per-parameter metadata (`param: { description }`).

### 2.3 Verdict on the emitter

**Pick `zod-openapi@6`.**

Reasoning, in order of weight:

1. **It rides Zod's own JSON Schema converter.** For a greenfield project on Zod 4, a per-type
   transformer table is a liability we would eventually hit — `UnknownZodTypeError` on some type Zod
   added last month is a failure mode we do not want in the build. Delegating means the emitter's
   type coverage is definitionally Zod's.
2. **No monkey-patching.** `.meta()` only. Given a Koa app assembled from many route modules, a
   global side-effecting `extendZodWithOpenApi()` that must run before any schema module is imported
   is a real ordering hazard, and the vendor's own docs call it "tricky".
3. `io: 'input' | 'output'` + `outputId` give us clean, separately-named request and response
   components — which matters here because the admin API has schemas with defaults (`enabled`,
   retry config) where the request and response shapes genuinely differ.

Trade-offs accepted:

- **`z.date()` is off the table** (§1). Enforce `z.iso.datetime()` in review. Arguably a feature:
  the wire format becomes explicit rather than dependent on a serializer.
- **Smaller install base** (1.05M vs 3.55M weekly) and a single maintainer. Mitigation: the emit step
  is one function call behind our own module boundary, and both libraries consume the same Zod
  schemas — a switch to `@asteasolutions/zod-to-openapi` would touch the emitter module and nothing
  else. Keep that boundary.
- **No route registry.** `zod-openapi` takes a whole `paths` object; it does not collect routes for
  you. Since we are writing the Koa wrapper anyway (§3), *we* own the registry, so this costs
  nothing. If we later decided to buy the registry rather than build it, `@asteasolutions` +
  `registerPath()` is the fallback.
- **Pin `zod` and `zod-openapi` exactly and bump them together** — the 5.4.4/5.4.6 changelog entries
  show Zod patch releases breaking generation.

**Emit OpenAPI `3.1.0`, not 3.2.0.** 3.1 is where the JSON Schema dialect matches Zod's default
(2020-12) and where the entire client-generation and doc-rendering ecosystem is. OpenAPI 3.2.0 was
only released **2025-09-19** ([OAI releases](https://github.com/OAI/OpenAPI-Specification/releases)),
alongside 3.1.2, and buys us nothing the admin contract needs.

---

## 3. Koa integration — this is the gap

**There is no maintained Koa router, as of 2026-08-04, that takes one route declaration and both
validates with Zod at runtime and registers the route into the OpenAPI document.** Stating it
plainly because the alternative — registering routes and schemas separately — would let validation
and the published document drift apart, which defeats the entire code-first decision.

### 3.1 `koa-zod-router` is dead, Zod 3-only, and emits no OpenAPI

- **`koa-zod-router@2.3.0`, published 2024-05-19** — no release in ~26 months
  ([registry](https://registry.npmjs.org/koa-zod-router)).
- **`peerDependencies: { "koa": ">=2.14.1 <3.x", "zod": ">=3.22.4 <4.x" }`** (verified directly from
  the manifest). It **excludes Zod 4 and excludes Koa 3 by explicit upper bound.** Its runtime deps
  also pin `@koa/router@^12.0.1` and the deprecated `koa-bodyparser`.
- The README's first line is
  *"# This library is no longer maintained, and is not accepting pull requests."*
  ([README](https://github.com/JakeFenley/koa-zod-router/blob/main/README.md)).
- **It never did OpenAPI.** Its `src/` is six files — `index.ts`, `multipart-parser-middleware.ts`,
  `types.ts`, `util.ts`, `validation-middleware.ts`, `zod-router.ts` — with nothing spec-related, and
  a GitHub code search for `openapi` in the repo returns `total_count: 0`.
- 4,816 downloads/week against Koa's 7.86M — i.e. essentially unused.

Its ergonomics are still the right model to copy:
`createRouteSpec({ method, path, handler, validate: { params, body, query, headers, response } })`.

### 3.2 Nothing else fills it

Searched the npm registry (`/-/v1/search`) for `koa zod openapi`, `koa openapi`, `koa zod`,
`koa swagger`, `koa router openapi generate`, `koa schema validation typescript`:

| Package | Version | Last publish | One-declaration validate + document? |
|---|---|---|---|
| `koa-zod-router` | 2.3.0 | 2024-05-19 | No — validation only; unmaintained; Zod 3 / Koa 2 |
| `@venue/koa-zod-router` | 3.0.2 | 2025-11-07 | No. Third-party fork whose only change is `koa-bodyparser` → `@koa/bodyparser`; **same Zod 3 / Koa 2 peers**; 3 versions published within 34 minutes by a single maintainer. Not a credible dependency. |
| `koa-swagger-decorator` | 1.8.7 | 2023-09-12 | Closest *conceptual* analogue (decorators → doc + validation) but **no Zod** (uses `validator` + `ramda`), pins `@koa/router@^10`, ~3 years stale |
| `koa-openapi` / `openapi-framework` | 12.1.3 | 2023-05-24 | Spec-first (document → routes) — opposite direction, not Zod |
| `koa-openapi-validator` | 4.12.0-beta.5 | 2021-01-30 | Spec-first, permanently beta, abandoned |
| `@nahkies/typescript-koa-runtime` | 0.26.0 | 2026-06-13 | Maintained, but codegen: an existing OpenAPI doc generates Koa handlers. Spec-first. |
| `koa2-swagger-ui` | 5.12.0 | 2025-09-16 | Only *serves* a document you already have |
| `koas-core`, `@36node/koa-openapi`, `koa-swagger-router`, `koa-swagger-joi`, `exegesis` | — | 2016–2025 | None are Zod + declaration-first |

### 3.3 What the neighbours ship — the shape of the missing piece

The pattern is well-established everywhere except Koa, and all of these are already on Zod 4:

- **`@hono/zod-openapi@1.5.1`** (2026-07-15), `peerDependencies: { "zod": "^4.0.0", "hono":
  ">=4.10.0" }`, built on `@asteasolutions/zod-to-openapi@^8.5.0`. One `createRoute({ method, path,
  request, responses })` object drives validation (`c.req.valid('param')`), handler typing, and
  `app.doc('/doc', …)`
  ([README](https://github.com/honojs/middleware/blob/main/packages/zod-openapi/README.md)).
- **`fastify-zod-openapi@5.7.0`** (2026-07-20) — same idea on Fastify, built on `zod-openapi`;
  provides a type provider plus validator/serializer compilers and Swagger UI
  ([README](https://github.com/samchungy/fastify-zod-openapi/blob/master/README.md)).
- **`express-zod-api@29.0.1`** (published 2026-08-04), peers `zod ^4.3.4` / `express ^5.1.0`;
  endpoint factory declares `input`/`output` once and the documentation generator walks the routing
  tree.

So the missing Koa piece is glue, not machinery: both the validator (Zod 4) and the emitter
(`zod-openapi@6`) already exist and already support Zod 4. Nobody has written the binding.

### 3.4 The substrate is healthy

- **`koa@3.2.1`**, published **2026-05-21**, `engines: { node: ">= 18" }`. Koa 3 is the `latest`
  tag; `latest-2: 2.16.4` (2026-02-25) is the maintenance line
  ([registry](https://registry.npmjs.org/koa)).
- **`@koa/router@15.7.0`**, published **2026-07-04**,
  `peerDependencies: { "koa": "^2.0.0 || ^3.0.0" }`, on `path-to-regexp@^8`
  ([registry](https://registry.npmjs.org/@koa/router/latest)). Actively released.
- **`@koa/bodyparser@6.1.0`**, published 2026-01-24 — the current, maintained body parser (Koa does
  not parse bodies itself) ([registry](https://registry.npmjs.org/@koa/bodyparser/latest)).
- **Route metadata is enumerable but not extensible.** v15 is a TypeScript rewrite: `src/router.ts`
  exposes a public `stack: Layer[]`, and `src/layer.ts` exposes `opts`, `name`, `methods`,
  `paramNames`, `path`, `regexp` ([source](https://github.com/koajs/router/tree/master/src)).
  However `LayerOptions` (`src/types.ts`) is a **closed type with no free-form metadata slot**, so a
  wrapper must keep its own registry rather than smuggle Zod schemas through layer options.

### 3.5 What the thin in-house wrapper has to do

Four seams. All the hard work is delegated to Zod 4 and `zod-openapi`; the wrapper is glue on the
order of a couple of hundred lines.

1. **A route-definition type + a `defineRoute()` identity helper.** One object is the source of
   truth for validation, handler typing, and the document:

   ```ts
   type RouteDef<P, Q, B> = {
     method: 'get' | 'post' | 'put' | 'patch' | 'delete';
     path: string;                       // Koa syntax, ':channel'
     operationId: string;
     summary?: string;
     tags?: string[];
     security?: ...;                     // operator API key
     request?: { params?: ZodType<P>; query?: ZodType<Q>; body?: ZodType<B> };
     responses: Record<number, { schema?: ZodType; description: string }>;
     handler: (ctx: TypedContext<P, Q, B>) => Promise<void>;
   };
   ```

   The `defineRoute()` wrapper exists purely so inference flows without manual generics — that is
   what makes the validated body typed *from the same object that documents the endpoint*.

2. **A registry.** An array of `RouteDef`s accumulated at module load, plus the component schemas.
   Do **not** try to recover schemas from `@koa/router`'s `stack` — `LayerOptions` cannot carry them
   (§3.4). Own the list and drive the router *from* it. Fail loudly on duplicate `method + path` and
   on duplicate `operationId` (the client generator uses it for method names).

3. **The validating middleware.** Per route, ahead of the handler: `safeParse` `ctx.params`,
   `ctx.query`, and `ctx.request.body` against the declared schemas; write results into a namespaced
   slot (`ctx.state.validated = { params, query, body }`) rather than mutating `ctx.request`; on
   failure throw a 400 carrying `z.treeifyError(result.error)`. Params and query arrive as strings,
   so those schemas need `z.coerce.*`. Then
   `router.register(def.path, [def.method], [validate(def), def.handler])`.
   Optionally validate the *response* against `responses[ctx.status].schema` behind a dev/test-only
   flag — cheap, and it is what actually stops the document from lying.

4. **The emit step.** Walk the registry once, translate paths from `:channel` to `{channel}`, and
   build the `zod-openapi` `paths` object — `requestParams: { path, query }`, `requestBody.content`,
   `responses` — then `createDocument({ openapi: '3.1.0', info, servers, paths, components })`.

Non-obvious things to get right, each of which is a way to silently ship a wrong document:

- **`io` must differ between request and response.** Request schemas are `'input'`, responses are
  `'output'`. Get this backwards and every schema with a `.default()` or a transform documents the
  wrong shape. Both emitters support it; a naive wrapper forgets it.
- **Reject `RegExp` paths** in `defineRoute` — `@koa/router` accepts them, OpenAPI cannot express
  them.
- **`path-to-regexp` v8 vs OpenAPI templating** — `:channel` → `{channel}` translation must be a
  single function, tested, and must reject unsupported patterns (optional segments, wildcards)
  rather than emit a path that no client generator can parse.
- **The registry must be the only way to add a route.** A bare `router.get(...)` anywhere bypasses
  both validation and the document. Enforce with a lint rule or by not exporting the raw router.

**Drift control (this is the point of the whole exercise):** commit the emitted spec and make CI
regenerate and diff it. Two supporting tools, both current:
[`@redocly/cli@2.43.3`](https://registry.npmjs.org/@redocly/cli/latest) (published **2026-08-03**)
for `lint` / `build-docs`, and [`oasdiff@v1.27.0`](https://github.com/oasdiff/oasdiff/releases)
(released **2026-07-30**) for breaking-change detection between the committed spec and the newly
emitted one. A CI job that fails when the emitted document differs from the committed one turns the
spec into a reviewed artifact instead of a runtime side effect — and it is the only mechanism that
catches wrapper bugs of the kind listed above.

---

## 4. Client generation from the emitted spec

The dashboard is React + TanStack Query, so the question is not "which generator is nicest" in the
abstract but "which one produces good TanStack Query v5 ergonomics from a 3.1 spec".

**TanStack Query context:** `@tanstack/react-query@5.101.4`, published **2026-07-21**. Its dist-tags
contain no 6.x line (`{ alpha: 5.0.0-alpha.91, beta: 5.0.0-beta.35, rc: 5.0.0-rc.16, previous:
4.44.0, latest: 5.101.4 }`) — **v5 is current and stable**, so all three candidates below are
targeting the right major.

### 4.1 `openapi-typescript` + `openapi-fetch` + `openapi-react-query`

| Package | Version | Published |
|---|---|---|
| `openapi-typescript` | 7.13.0 | 2026-02-11 |
| `openapi-fetch` | 0.17.0 | 2026-02-11 |
| `openapi-react-query` | 0.5.4 | 2026-02-11 |

All MIT, all in the one monorepo (`openapi-ts/openapi-typescript`), all released together.

- **Types only, zero runtime.** The README's own framing: *"Generate **runtime-free types** that
  outperform old school codegen"*, and *"Supports OpenAPI 3.0 and 3.1 (including advanced features
  like discriminators)"*
  ([README](https://github.com/openapi-ts/openapi-typescript/blob/main/packages/openapi-typescript/README.md)).
  There is no generated client code to review, diff, or keep in sync — just a `paths` type.
- **`openapi-fetch`** is *"~6 kB"* and *"All parameters, request bodies, and responses are
  type-checked and 100% match your schema"* ([openapi-ts.dev](https://openapi-ts.dev/openapi-fetch/)).
  Path strings are literal types drawn from `paths`, so a wrong URL or a missing path param is a
  compile error — not a runtime 404.
- **`openapi-react-query` is the official TanStack binding**, peer
  `{ "openapi-fetch": "^0.17.0", "@tanstack/react-query": "^5.80.0" }` (verified from the manifest) —
  v5 required, not merely tolerated. Exported surface, from
  [`src/index.ts`](https://github.com/openapi-ts/openapi-typescript/blob/main/packages/openapi-react-query/src/index.ts):
  `queryOptions`, `useQuery`, `useSuspenseQuery`, `useInfiniteQuery`, `useMutation`.

  ```ts
  const fetchClient = createFetchClient<paths>({ baseUrl: '/api/' });
  const $api = createClient(fetchClient);
  const { data, error, isLoading } = $api.useQuery('get', '/channels/{channel}/broadcasts', {
    params: { path: { channel } },
  });
  ```
  Query keys are derived automatically ([docs](https://openapi-ts.dev/openapi-react-query/)).
- **Adoption:** `openapi-typescript` ~6.03M downloads/week — the largest of the three candidates.
- **Limits:** no `useSuspenseInfiniteQuery`, no generated prefetch/invalidate helpers, no
  per-operation method names, and no generated Zod validators. `queryOptions(...)` *is* exported, so
  prefetching / `ensureQueryData` remain reachable by hand. `openapi-react-query` is a 0.5.x package
  that has not shipped since 2026-02-11 — the thinnest, least-maintained link in the chain.

### 4.2 Hey API — `@hey-api/openapi-ts`

- **0.99.0**, published **2026-06-22**, MIT
  ([license page](https://heyapi.dev/docs/openapi/typescript/license)). ~4.07M downloads/week.
  Registry `modified: 2026-08-03` — very active, with a `next` channel.
- **TanStack Query plugin** (`'@tanstack/react-query'`) advertises *"TanStack Query v5 support /
  create query keys following the best practices / type-safe query options, infinite query options,
  and mutation options"*
  ([docs](https://heyapi.dev/docs/openapi/typescript/plugins/tanstack-query)).
  It emits **`queryOptions` functions rather than hooks** — `getPetByIdOptions()`,
  `getPetByIdQueryKey()`, `getPetByIdInfiniteOptions()`, `addPetMutation()` — consumed as
  `useQuery({ ...getPetByIdOptions({ path: { petId: 1 } }) })`. Query keys are structured objects
  (`_id`, `baseUrl`, `path`, optional `tags`), which gives clean prefix invalidation.
- **OpenAPI 3.1:** *"Hey API supports all valid OpenAPI versions and file formats"*, with an explicit
  `{ openapi: '3.1.1' }` example
  ([input docs](https://heyapi.dev/docs/openapi/typescript/configuration/input)).
- **It can emit Zod back out.** Separate `zod` (v4), `zod/v3` and `zod/mini` plugins produce *"Zod
  schemas for requests, responses, and reusable definitions"*, and the SDK accepts
  `validator: true` / `transformer: true` to actually run them
  ([zod/v4 plugin](https://heyapi.dev/docs/openapi/typescript/plugins/zod/v4)). That is a genuinely
  interesting closing of the loop for our architecture: Zod on the server → spec → Zod again on the
  client.
- **Costs:** still **pre-1.0 after ~2 years**, with a maintained
  [migration page](https://heyapi.dev/docs/openapi/typescript/migrating) because breaking minors are
  routine. Also every config example in the docs uses `input: 'hey-api/backend' // sign up at
  app.heyapi.dev`, their hosted spec registry — which is itself labelled *"This feature is in
  development!"* ([integrations](https://heyapi.dev/docs/openapi/typescript/integrations)). The
  codegen is MIT with no paywalled plugins, so this is a directional/strategic concern, not a
  licensing blocker.

### 4.3 Orval

- **8.23.0**, published **2026-07-25**, MIT. ~1.78M downloads/week.
- `client` modes include `react-query`, `zod`, `fetch`, `hono`, `mcp` and more; default `httpClient`
  became `fetch` in v8 ([v8 notes](https://orval.dev/docs/versions/v8)).
- **Emits hooks, not queryOptions** — one `useXxx` per operation plus a `getXxxQueryKey` factory,
  with a large `override.query` toggle surface (`useSuspenseQuery`, `useInfinite`,
  `useSuspenseInfiniteQuery`, `usePrefetch`, `useInvalidate`, `useSetQueryData`,
  `mutationInvalidates`, `runtimeValidation`, …). Richest feature set of the three.
- **Best-in-class 3.1 handling:** v8 switched its validator to `@scalar/openapi-parser` (*"what
  previously surfaced as warnings is now a hard error"*), always-on validation, and it
  *"automatically resolves JSON Schema 2020-12 `$dynamicRef` / `$dynamicAnchor` keywords in OpenAPI
  3.1 specs"*, plus *"Zod `nullable` + `$ref` support (OpenAPI 3.1 compliance)"* (v8 notes /
  `llms-full.txt`).
- **Costs:** requires **Node ≥ 22.18 and full ESM**; by far the largest configuration surface; and
  the published [react-query guide](https://orval.dev/docs/guides/react-query) still shows the
  **TanStack Query v4 positional signature** `useQuery(queryKey, queryFn, opts)` that v5 removed —
  the generated code is v5-correct, but that is a bad signal for docs maintenance during onboarding.

### 4.4 The "publish the Zod schemas as a package instead" option

Viable as a *supplement*, not a substitute, and it fails the map's stated goal ("a typed client
generated from the emitted spec so other projects can integrate easily"):

- **Non-TypeScript consumers get nothing** — no Python/Go client, no Postman/Insomnia import, no
  contract-testing or gateway tooling. All of those consume OpenAPI, not Zod.
- **Zod describes payloads, not the HTTP surface** — no paths, methods, status codes, auth schemes,
  or parameter locations. The dashboard would still hand-write every URL and method, which is exactly
  the bug class the generated `paths` type eliminates.
- **Version coupling** — backend and frontend must share one `zod` major forever, and Zod ships to
  the browser even when only types are needed.
- **Server-only constructs leak** — `.transform()`, `.refine()`, `.brand()`, `z.custom()` have no
  client meaning and often no JSON Schema representation at all (§1).

Sensible hybrid if we later want shared branded IDs: publish a tiny **types-only** package. No Zod
runtime across the boundary.

### 4.5 Verdict on client generation

**Pick `openapi-typescript@7` + `openapi-fetch@0` + `openapi-react-query@0.5`.**

Reasoning:

1. **The published contract is the OpenAPI document, not our generator choice.** Third parties will
   run whatever generator they prefer against our committed spec. That means our own generator should
   be optimised for *minimum liability*, not maximum features — and a types-only generator has no
   generated runtime to review, diff, or debug.
2. **It already gives us the composable primitive.** The main argument for Hey API over Orval is
   `queryOptions` over hooks — but `openapi-react-query` exports `queryOptions` too, so that argument
   does not separate it from this stack. What we lose is convenience wrappers, not composability.
3. **Stability matters more than ergonomics on a contract path.** Hey API is pre-1.0 with routine
   breaking minors; Orval needs Node ≥22.18 + full ESM and has a docs surface we'd be fighting. This
   stack is the smallest thing that fully satisfies the dashboard's needs.
4. **Largest install base** (~6.03M/week) and one monorepo covering types, client, and TanStack
   binding, released in lockstep.

**Named switch trigger — do not re-litigate this without one:** adopt
**`@hey-api/openapi-ts` + its `@tanstack/react-query` plugin** if either (a) we decide the dashboard
needs *generated runtime response validation* (Hey API's `zod` plugin + `validator: true` is the only
candidate that gives this for free), or (b) `openapi-react-query` stays unreleased long enough to
break against a future TanStack Query minor. It is a real second choice, not a courtesy mention: it
is actively developed and its query-key design is better than ours.

**Orval** would be the pick for a migration or a mock-heavy/multi-framework shop (MSW + Faker
generators, Angular, Effect, MCP). Not this project.

**Regardless of the pick: commit the generated client and regenerate in CI with a diff check.** That
makes a backend contract change show up as a reviewable frontend diff instead of a silent runtime
break — the same discipline as the committed spec in §3.5.

---

## 5. Serving the doc

| Package | Version | Published | License | OpenAPI 3.1? |
|---|---|---|---|---|
| `@scalar/api-reference` | **1.64.0** | 2026-07-31 | MIT | Yes — 3.2, 3.1, 3.0, 2.0 |
| `@scalar/client-side-rendering` | 0.3.5 | 2026-07-31 | MIT | (renders the above) |
| `swagger-ui-dist` | **5.32.12** | 2026-08-03 | Apache-2.0 | Yes — incl. 3.1.2 and 3.2.0 |
| `redoc` | **2.5.3** | 2026-05-29 | MIT | Yes — 3.1, 3.0, Swagger 2.0 |

- Scalar's parser is 3.1-native: *"Modern OpenAPI parser written in TypeScript with support for
  OpenAPI 3.2, 3.1, 3.0 and Swagger 2.0"*
  ([@scalar/openapi-parser README](https://github.com/scalar/scalar/blob/main/packages/openapi-parser/README.md)).
- Swagger UI publishes the only authoritative per-version compatibility matrix — the `5.32.0` row
  lists `2.0, 3.0.0…3.0.4, 3.1.0, 3.1.1, 3.1.2, 3.2.0`
  ([README](https://github.com/swagger-api/swagger-ui/blob/master/README.md)).
- Redoc claims *"Support for OpenAPI 3.1, OpenAPI 3.0, and Swagger 2.0"*
  ([README](https://github.com/Redocly/redoc/blob/main/README.md)), but `latest` is from 2026-05-29
  and a `3.0.0-rc.0` has been parked for a long time.

**⚠️ Scalar has no official Koa integration.** A search across the 2,039 `@scalar`-matching npm
packages (`https://registry.npmjs.org/-/v1/search?text=@scalar&size=100`) returns exactly one Koa
hit and it is third-party (`@voilab/koa-scalar@0.4.2`, 2026-07-10). The official framework packages
are `@scalar/hono-api-reference`, `@scalar/express-api-reference`, `@scalar/fastify-api-reference`,
`@scalar/nestjs-api-reference`, `@scalar/nextjs-api-reference`, `@scalar/api-reference-react` (all
1.64.0/0.1x.x, 2026-07-31), and Koa is absent from the ~34 integrations listed in the
[Scalar README](https://github.com/scalar/scalar/blob/main/README.md).

**This costs us about five lines, not a workaround.** `@scalar/express-api-reference`'s only
dependency is `@scalar/client-side-rendering` — the official integrations are thin HTML-string
wrappers over the same renderer:

```ts
import { renderApiReference } from '@scalar/client-side-rendering';
const html = renderApiReference({ pageTitle: 'webhook-broadcast admin API',
                                  config: { url: '/openapi.json' } });
router.get('/docs', (ctx) => { ctx.type = 'html'; ctx.body = html; });
```

### 5.1 Verdict on doc serving

**Serve Scalar as HTML from Koa ourselves, from a spec file committed to the repo.**

- Freshest of the three (2026-07-31 vs Redoc's 2026-05-29), 3.1-native parser rather than 3.1 bolted
  onto a 3.0 renderer, good built-in request client for an internal admin API, MIT. It is also the
  same parser Orval v8 adopted, so what Scalar renders and what generators accept stay aligned.
- **Two configuration hazards to fix deliberately:** (1) the docs' default config includes
  `proxyUrl: 'https://proxy.scalar.com'` — **remove it**, or "Try it" requests against a self-hosted
  internal API leave the network; (2) prefer self-hosting `@scalar/api-reference` from
  `node_modules` over the CDN `<script>` snippet, so the admin dashboard has no third-party network
  dependency at page load. Pin the version — Scalar ships weekly.
- **Fallback if we want boring and bulletproof:** `swagger-ui-dist@5.32.12` served via `koa-static`.
  Apache-2.0, the only renderer with a published spec-compatibility matrix and the only one already
  claiming 3.2.0. Less pleasant, and Zod-derived 3.1 output (`type: ['string','null']`, `$defs`) will
  look clunkier — but nothing about it will surprise us.
- **Skip Redoc:** read-only (no request client), slowest cadence, unlanded 3.0 RC.

**Commit the spec; do not generate it at runtime only.** Serving `GET /openapi.json` from the live
registry is fine and useful, but the artifact of record is a checked-in `openapi.json` (or `.yaml`)
that CI regenerates and diffs (§3.5). That is what makes the contract reviewable, gives `oasdiff` a
baseline for breaking-change detection, and lets the frontend's generated client be produced from a
file rather than from a running server.

---

## 6. Recommended toolchain, assembled

```
Zod 4.4.3  ──.meta({ id })──►  zod-openapi 6.0.0  ──createDocument({openapi:'3.1.0'})──►  openapi.json
    │                                    ▲                                                    │ (committed)
    │                                    │                                                    ├──► Scalar @ /docs
    └──► in-house defineRoute() registry ┘                                                    └──► openapi-typescript 7
             │                                                                                        │
             └──► Koa 3.2.1 + @koa/router 15.7.0 + @koa/bodyparser 6.1.0                              ├──► openapi-fetch
                  (validating middleware, ctx.state.validated)                                        └──► openapi-react-query
                                                                                                             + @tanstack/react-query 5
```

1. **`zod@4.4.3`** — schemas are the source of truth. **No `z.date()` on the wire**; use
   `z.iso.datetime()`.
2. **`zod-openapi@6.0.0`** as the emitter — rides Zod's native `z.toJSONSchema()`, no
   monkey-patching, `io: 'input' | 'output'` for request/response divergence. Pin it and `zod`
   together.
3. **A thin in-house Koa wrapper** (§3.5) — `defineRoute()` + a registry + validating middleware +
   the emit step. **This is the piece with no off-the-shelf option and the piece most likely to
   introduce drift; treat it as real work with its own tests, not glue.**
4. **Emit OpenAPI 3.1.0, commit it, and diff it in CI** with `@redocly/cli@2.43.3` (lint) and
   `oasdiff@v1.27.0` (breaking-change detection).
5. **`openapi-typescript@7.13.0` + `openapi-fetch@0.17.0` + `openapi-react-query@0.5.4`** for the
   dashboard; commit the generated output and regenerate in CI. Switch to
   `@hey-api/openapi-ts` only on the triggers named in §4.5.
6. **Scalar (`@scalar/api-reference@1.64.0`)** served as HTML from Koa, self-hosted, `proxyUrl`
   removed.

### Open risks to carry forward

- **The in-house wrapper is the single point of failure for the code-first decision.** The CI
  spec-diff plus dev-mode response validation are the two controls that make it safe; both should be
  in the first implementation, not deferred.
- **`zod` ↔ `zod-openapi` patch coupling** (5.4.4 and 5.4.6 both fixed breakage caused by Zod patch
  releases). Exact pins, joint upgrades, and the spec-diff job will catch regressions.
- **`openapi-react-query@0.5.4` has not shipped since 2026-02-11** and is the thinnest link in the
  client chain. Low blast radius (it is a wrapper over `queryOptions`), but it is the dependency most
  likely to need replacing within a year.
