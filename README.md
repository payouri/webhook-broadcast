# webhook-broadcast

A single-tenant webhook multiplexer. See `CONTEXT.md` for domain vocabulary and `docs/adr/` for
architectural decisions.

## Layout

pnpm workspace (`docs/adr/0006-repository-layout-toolchain.md`):

- `apps/api` — Koa HTTP server and BullMQ Delivery worker, run as separate processes from one
  image (`server` | `worker` | `migrate` commands — `docs/adr/0008-process-topology-deploy.md`).
- `apps/web` — Vite + React admin dashboard.
- `packages/contract` — Zod schemas: boot env validation and (later) the OpenAPI wire contract.
- `packages/db` — Drizzle schema, Postgres client, and the migration runner.

## Requirements

Node 24, pnpm 9+, Docker with Compose v2.

## Local development

```bash
pnpm install
cp .env.example .env   # localhost:5433 Postgres, localhost:6380 Redis
docker compose up -d   # Postgres + Redis only; api/worker/web are profiled out
pnpm run migrate

pnpm run dev            # api (:8080) + worker (:9091) + web (:5173)
# or individually:
# pnpm run dev:api
# pnpm run dev:worker
# pnpm run dev:web
```

### Placeholder data

```bash
pnpm run seed             # reset the fixture rows, then reseed
pnpm run seed -- --clean  # remove the fixture rows only
```

Fills the database with Channels covering every dashboard state — a busy Channel with enough
Broadcasts to paginate, retries and dead letters, an auto-disabled Endpoint, an in-flight backlog,
a disabled Channel, an open-ingest Channel, a soft-deleted Channel, and an empty one. Fixture ids
are deterministic, so reseeding keeps the same URLs and only ever touches its own rows. Freshly
minted ingest and operator tokens are printed once per run (only hashes are stored).

Required env vars (`DATABASE_URL`, `REDIS_URL`, `OPERATOR_API_KEY`) are Zod-validated at process
boot in all three commands — a missing or invalid value fails fast with a printed diagnostic
instead of failing later at first use.

### Postgres TLS

`server`, `worker`, and `migrate` all resolve TLS the same way (`packages/db/src/ssl.ts`):

- **Local Compose**: `DATABASE_URL` carries no `sslmode` at all — Postgres speaks plain TCP on
  the Compose network, as in `.env.example`.
- **Managed Postgres, encrypt-only**: use
  `DATABASE_URL=...?sslmode=require&uselibpqcompat=true`. Do **not** use bare `?sslmode=require` —
  `pg-connection-string@2.x` (pulled in by `pg@^8`) treats `prefer`/`require`/`verify-ca` as
  aliases for `verify-full`, so the client verifies the server certificate against Node's bundled
  trust store. Managed providers (RDS, Cloud SQL, ...) sign with their own root, which generally
  isn't in that store, so bare `sslmode=require` fails where the deployment only asked for
  encryption — the `pg` client's own deprecation warning ("SSL modes 'prefer', 'require', and
  'verify-ca' are treated as aliases for 'verify-full'") is describing exactly this. The
  `uselibpqcompat=true` flag opts into libpq's actual meaning of `require`: encrypt, don't verify.
- **Managed Postgres, verify the server cert (recommended)**: set `DATABASE_CA_CERT` to the
  provider's CA bundle (PEM; literal newlines or `\n`-escaped both work), and leave `DATABASE_URL`
  free of every `ssl*` parameter. Pinning happens in code rather than through the connection
  string, so the two cannot be combined: `pg` re-parses the connection string _after_ merging in
  explicit config, and any `ssl*` parameter there would silently discard the pinned CA. Rather
  than let that happen, the combination fails fast at boot with a
  `ConflictingDatabaseSslConfigError` naming the offending parameters.

This is deliberately pinned in code instead of left to `pg`'s own default: `pg-connection-string`
plans to flip `sslmode`'s meaning again in v3 (pg v9) — the same URL that verifies today would
silently start only encrypting. See the issue that added this (#102) for the full history.

### Redis TLS

`server` and `worker` both resolve Redis TLS the same way (`apps/api/src/redisTls.ts`) — the same
decision as Postgres above, applied to a second datastore:

- **Local Compose**: `REDIS_URL` is `redis://` — plaintext, as in `.env.example`. The scheme
  alone decides this: a `redis://` URL stays plaintext and `REDIS_CA_CERT` is ignored, so
  switching a deployment to TLS means changing the scheme, not just supplying a CA.
- **Managed Redis, encrypt-only**: `REDIS_URL=rediss://...`, `REDIS_CA_CERT` unset. Unlike
  Postgres, ioredis has no `sslmode`/`sslrootcert`-style query parameter at all — the scheme is
  the entire config surface for TLS — so this is the only way to ask for encryption without
  verification. Left to ioredis's own defaults, a `rediss://` URL defers to Node's `tls.connect`
  behaviour (`rejectUnauthorized: true`) and verifies the server certificate against Node's
  bundled trust store, which a managed provider's own root generally isn't in — so
  `resolveRedisTls` sets `rejectUnauthorized: false` explicitly instead of relying on that.
- **Managed Redis, verify the server cert (recommended)**: `REDIS_URL=rediss://...` and set
  `REDIS_CA_CERT` to the provider's CA bundle (PEM; literal newlines or `\n`-escaped both work).
  There is no `ssl*` URL parameter for it to conflict with — unlike `DATABASE_CA_CERT`, this
  combination has nothing to refuse.

Every construction site (the worker's metrics `Queue` and `Worker`, and `BullMqDeliveryQueue`'s
`Queue` and its `ping()` client — the client backing `/ready`'s Redis check) goes through
`resolveRedisTls`/`resolveRedisConnectionOptions` rather than passing `{ url: REDIS_URL }` alone
and relying on ioredis's scheme handling. See the issue that added this (#104) for the full
history, including why the `ping()` site in particular matters.

## OpenAPI contract

The admin API publishes an OpenAPI 3.1 contract, emitted from Zod schemas in `packages/contract`
(`pnpm contract:emit`) and drift-checked against the committed sketch in CI (`pnpm contract:check`).
A running deployment serves the contract at `/openapi.json` (JSON), `/openapi.yaml` (YAML), and
`/docs` (rendered interactive reference via Scalar) — all three require operator authentication
(a bearer token, or the dashboard's session cookie, which is what makes `/docs` usable in a
browser) and are gated by `DOCS_ENABLED` (default on, `404` with `docs_disabled` when off).
See `docs/adr/0005-admin-api-contract.md` for the contract shape and serving decisions.

## Tests

```bash
pnpm test          # vitest run
pnpm run typecheck # tsc --noEmit across all packages
pnpm run lint       # oxlint
pnpm run format     # prettier --check
```

## Full stack via Compose

```bash
cp .env.example .env
docker compose --profile app up --build
```

Brings up Postgres, Redis, a one-shot `migrate` job, then `api` (`:8080`), `worker`
(health on `:9091`), and `web` (`:5173`). `api` and `worker` wait on `migrate` completing
successfully and on Postgres/Redis healthchecks before starting; `web` waits on `api`
being healthy.

Every published port binds to `127.0.0.1` only. Host ports are overridable via
`POSTGRES_HOST_PORT`, `REDIS_HOST_PORT`, `API_HOST_PORT`, `WORKER_HOST_PORT` and
`WEB_HOST_PORT`. Compose pins each in-container listen port to its default, so remapping
a host port can't desync a service's listen port from its healthcheck.

Outside Compose those in-container ports do move: `api` takes `PORT`, `worker` takes
`WORKER_HEALTH_PORT`, and `web` — whose nginx config is rendered from a template at
start-up — takes `WEB_PORT` plus `API_UPSTREAM` for the api it proxies to. That last pair
is what lets `web` and `api` share a single network namespace, as in an ECS `awsvpc` task
where there is no per-container hostname. See ADR 0008 for the two variables' constraints.

- `curl localhost:8080/health` — API liveness
- `curl localhost:8080/ready` — API readiness (Postgres + Redis dependency checks)
- `curl localhost:9091/health` — worker liveness
