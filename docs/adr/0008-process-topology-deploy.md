# Process topology, config, and deployment

API and Delivery worker run as **separate processes** from one image (`server` | `worker` | `migrate` commands). BullMQ worker concurrency defaults to `WORKER_CONCURRENCY=10` with no per-endpoint limit for MVP. SIGTERM drains: API finishes HTTP; worker `close()` waits for in-flight Attempts — orchestrator grace must exceed `DELIVERY_TIMEOUT_MS` + margin. Config is env-only (Zod-validated at boot); Channel/Endpoint fields stay on the admin API. Compose: Postgres, Redis, migrate, api, worker, web. **Migrations always follow expand/contract** — additive expand ships before code that depends on it; destructive contract only after the fleet no longer reads the old shape; `drizzle-kit migrate` runs in a migrate service/job that completes before new api/worker start (`depends_on: service_completed_successfully`). See ADR 0011 for the concrete checklist and a worked example. API exposes `/health` (liveness) and `/ready` (Postgres+Redis); worker exposes `/health` on `WORKER_HEALTH_PORT` (default 9091). Retention sweeper runs as an interval inside the worker process for MVP.

## Env surface (boot-validated)

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `development` \| `test` \| `production`. Only read to decide whether the operator session cookie is marked `Secure`; the api Dockerfile sets `production` for the image |
| `DATABASE_URL` | — | required; TLS config: see README's "Postgres TLS" section |
| `DATABASE_CA_CERT` | unset | optional PEM CA; pins server-cert verification. Mutually exclusive with any `ssl*` parameter in `DATABASE_URL` |
| `REDIS_URL` | — | required; TLS config: see README's "Redis TLS" section |
| `REDIS_CA_CERT` | unset | optional PEM CA; pins `rediss://` server-cert verification. No `ssl*`-style URL param exists to conflict with it (unlike `DATABASE_CA_CERT`), so there's nothing to refuse |
| `OPERATOR_API_KEY` | — | required; Bearer + cookie |
| `PORT` | `8080` | API listen |
| `WORKER_HEALTH_PORT` | `9091` | worker health |
| `WORKER_CONCURRENCY` | `10` | BullMQ concurrency |
| `INGEST_MAX_BODY_BYTES` | `1048576` | |
| `INGEST_HEADER_ALLOWLIST` | empty | empty = all |
| `INGEST_HEADER_DENYLIST` | empty | |
| `INGEST_SUCCESS_STATUS` | `202` | must be 2xx; accepted-ingest response status, overridable per Channel via `channel.ingestSuccessStatus` |
| `HISTORY_RETENTION_DAYS` | `30` | |
| `DELIVERY_TIMEOUT_MS` | `10000` | |
| `DELIVERY_MAX_ATTEMPTS` | `8` | |
| `DELIVERY_BACKOFF_MS` | `5000` | |
| `DELIVERY_BACKOFF_MAX_MS` | `3600000` | |
| `ENDPOINT_AUTO_DISABLE_AFTER_MS` | `3600000` | |
| `COOKIE_NAME` | `wb_operator` | dashboard session cookie |
| `TRUST_PROXY` | `false` | `true` \| `false`. When `true`, the session cookie's `Secure` flag follows `X-Forwarded-Proto`; when `false` it follows `NODE_ENV`, so a directly exposed API cannot be tricked into issuing a session cookie over plain HTTP |
| `LOGIN_RATE_LIMIT_MAX_ATTEMPTS` | `5` | failed `POST /auth/login` attempts per client before lockout |
| `LOGIN_RATE_LIMIT_WINDOW_MS` | `60000` | rolling window the count above applies over, and the lockout duration |
| `DOCS_ENABLED` | `true` | gates operator-authenticated `GET /openapi.json` (issue #107); `false` answers `404` with `code: "docs_disabled"` rather than deregistering the route |

The `migrate` command validates a deliberately narrower surface — `DATABASE_URL` and `DATABASE_CA_CERT` only (`migrateEnvSchema`) — so a migration job never fails fast on unrelated misconfig such as a missing `OPERATOR_API_KEY`. The CA is part of it: a deployment pinning a provider CA must pass it to `migrate` too, or that job reaches the database on different TLS terms than api and worker.

## Compose host-side env surface (not boot-validated)

Read by `docker-compose.yml` alone — substituted into its `environment:` and `ports:` entries, never by a Node process, so they are outside both Zod schemas. Every port mapping binds to `127.0.0.1`.

| Variable | Default | Notes |
|---|---|---|
| `POSTGRES_USER` | `webhook_broadcast` | Postgres image seed; must match `DATABASE_URL` |
| `POSTGRES_PASSWORD` | `webhook_broadcast` | as above |
| `POSTGRES_DB` | `webhook_broadcast` | as above |
| `POSTGRES_HOST_PORT` | `5433` | host side of the Postgres mapping; not 5432, which a local Postgres usually holds |
| `REDIS_HOST_PORT` | `6380` | host side of the Redis mapping |
| `API_HOST_PORT` | `8080` | host side of the api mapping; the container side is pinned to 8080 |
| `WORKER_HOST_PORT` | `9091` | host side of the worker health mapping |
| `WEB_HOST_PORT` | `5173` | host side of the web mapping; the container side is `WEB_PORT` below |

## Web container env surface (nginx-rendered, not boot-validated)

The `web` image ships no Node process, so these two are outside the Zod schema above: they are substituted into `apps/web/nginx.conf.template` by the base image's entrypoint at start-up (issue #100). Rendering depends on that entrypoint — a deployment that replaces it gets the base image's stock config, with no `/ingest` proxying.

| Variable | Default | Notes |
|---|---|---|
| `WEB_PORT` | `8080` | nginx listen port *inside* the container; not `WEB_HOST_PORT`, which is the compose host-side mapping |
| `API_UPSTREAM` | `http://api:8080` | `proxy_pass` target; `scheme://host:port` with no path or trailing slash |

Together these let `web` and `api` run in one ECS `awsvpc` task, where the shared network namespace means there is no `api` hostname and only one container can hold a given port: the pair addresses each other over loopback (e.g. api on `PORT=8081`, web on `API_UPSTREAM=http://127.0.0.1:8081`). Compose leaves both at their defaults.
