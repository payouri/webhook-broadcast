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
