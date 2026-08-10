# Process topology, config, and deployment

API and Delivery worker run as **separate processes** from one image (`server` | `worker` | `migrate` commands). BullMQ worker concurrency defaults to `WORKER_CONCURRENCY=10` with no per-endpoint limit for MVP. SIGTERM drains: API finishes HTTP; worker `close()` waits for in-flight Attempts — orchestrator grace must exceed `DELIVERY_TIMEOUT_MS` + margin. Config is env-only (Zod-validated at boot); Channel/Endpoint fields stay on the admin API. Compose: Postgres, Redis, migrate, api, worker, web. **Migrations always follow expand/contract** — additive expand ships before code that depends on it; destructive contract only after the fleet no longer reads the old shape; `drizzle-kit migrate` runs in a migrate service/job that completes before new api/worker start (`depends_on: service_completed_successfully`). API exposes `/health` (liveness) and `/ready` (Postgres+Redis); worker exposes `/health` on `WORKER_HEALTH_PORT` (default 9091). Retention sweeper runs as an interval inside the worker process for MVP.

## Env surface (boot-validated)

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | — | required |
| `REDIS_URL` | — | required |
| `OPERATOR_API_KEY` | — | required; Bearer + cookie |
| `PORT` | `8080` | API listen |
| `WORKER_HEALTH_PORT` | `9091` | worker health |
| `WORKER_CONCURRENCY` | `10` | BullMQ concurrency |
| `INGEST_MAX_BODY_BYTES` | `1048576` | |
| `INGEST_HEADER_ALLOWLIST` | empty | empty = all |
| `INGEST_HEADER_DENYLIST` | empty | |
| `HISTORY_RETENTION_DAYS` | `30` | |
| `DELIVERY_TIMEOUT_MS` | `10000` | |
| `DELIVERY_MAX_ATTEMPTS` | `8` | |
| `DELIVERY_BACKOFF_MS` | `5000` | |
| `DELIVERY_BACKOFF_MAX_MS` | `3600000` | |
| `ENDPOINT_AUTO_DISABLE_AFTER_MS` | `3600000` | |
| `COOKIE_NAME` | `wb_operator` | dashboard session cookie |
