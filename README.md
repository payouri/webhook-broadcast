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
cp .env.example .env   # then start Postgres/Redis some other way, or via `docker compose up postgres redis`

pnpm run dev:api        # Koa server on $PORT (default 8080)
pnpm run dev:worker      # BullMQ worker + health server on $WORKER_HEALTH_PORT (default 9091)
pnpm run dev:web         # Vite dev server on :5173
pnpm run migrate         # apply pending Postgres migrations
```

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
docker compose up --build
```

Brings up Postgres, Redis, a one-shot `migrate` job, then `api` (`:8080`), `worker`
(health on `:9091`), and `web` (`:5173`). `api` and `worker` wait on `migrate` completing
successfully and on Postgres/Redis healthchecks before starting.

- `curl localhost:8080/health` — API liveness
- `curl localhost:8080/ready` — API readiness (stubbed until Postgres/Redis checks land)
- `curl localhost:9091/health` — worker liveness
