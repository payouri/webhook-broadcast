# Postgres schema and indexes

Six tables in `packages/db` (Drizzle + `drizzle-kit` SQL migrations): `channel`, `channel_token`, `endpoint`, `broadcast`, `delivery`, `attempt`. UUIDs as PKs; Delivery unique on `(broadcast_id, endpoint_id)`; Attempt unique on `(delivery_id, n)`. Inbound `broadcast.body` is `bytea`; headers on broadcast/endpoint are `jsonb`. `delivery.status` is a Postgres enum (`pending|in_progress|succeeded|failed|dead_lettered`). Retention deletes old `broadcast` rows and cascades to deliveries/attempts. Fan-out summaries and endpoint health (`successRate24h`, `p95`) are **computed in SQL**, not stored columns. Indexes: unique slug/token_hash/(channel_id,url); activity `(channel_id, received_at DESC, id DESC)`; retention `(received_at)`; fan-out `(broadcast_id)`; auto-disable streak `(endpoint_id, updated_at DESC)`; attempts `(delivery_id, n)`.

## Sketch

```sql
CREATE TYPE delivery_status AS ENUM (
  'pending', 'in_progress', 'succeeded', 'failed', 'dead_lettered'
);

CREATE TABLE channel (
  id            uuid PRIMARY KEY,
  slug          text NOT NULL UNIQUE,
  description   text,
  enabled       boolean NOT NULL DEFAULT true,
  deleted_at    timestamptz,
  created_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL
);

CREATE TABLE channel_token (
  id            uuid PRIMARY KEY,
  channel_id    uuid NOT NULL REFERENCES channel(id),
  token_hash    text NOT NULL UNIQUE,
  prefix        text NOT NULL,
  created_at    timestamptz NOT NULL
);
CREATE INDEX channel_token_channel_id_idx ON channel_token (channel_id);

CREATE TABLE endpoint (
  id                 uuid PRIMARY KEY,
  channel_id         uuid NOT NULL REFERENCES channel(id),
  name               text,
  url                text NOT NULL,
  timeout_ms         integer,
  headers            jsonb NOT NULL DEFAULT '{}',
  enabled            boolean NOT NULL DEFAULT true,
  auto_disabled_at   timestamptz,
  created_at         timestamptz NOT NULL,
  updated_at         timestamptz NOT NULL,
  UNIQUE (channel_id, url)
);
CREATE INDEX endpoint_channel_id_idx ON endpoint (channel_id);

CREATE TABLE broadcast (
  id            uuid PRIMARY KEY,
  channel_id    uuid NOT NULL REFERENCES channel(id),
  received_at   timestamptz NOT NULL,
  content_type  text NOT NULL,
  body          bytea NOT NULL,
  headers       jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX broadcast_channel_received_id_idx
  ON broadcast (channel_id, received_at DESC, id DESC);
CREATE INDEX broadcast_received_at_idx ON broadcast (received_at);

CREATE TABLE delivery (
  id                 uuid PRIMARY KEY,
  broadcast_id       uuid NOT NULL REFERENCES broadcast(id) ON DELETE CASCADE,
  endpoint_id        uuid NOT NULL REFERENCES endpoint(id),
  channel_id         uuid NOT NULL REFERENCES channel(id),
  status             delivery_status NOT NULL,
  attempt_count      integer NOT NULL DEFAULT 0,
  last_status_code   integer,
  last_duration_ms   integer,
  last_error         text,
  updated_at         timestamptz NOT NULL,
  UNIQUE (broadcast_id, endpoint_id)
);
CREATE INDEX delivery_broadcast_id_idx ON delivery (broadcast_id);
CREATE INDEX delivery_endpoint_updated_idx ON delivery (endpoint_id, updated_at DESC);

CREATE TABLE attempt (
  id            uuid PRIMARY KEY,
  delivery_id   uuid NOT NULL REFERENCES delivery(id) ON DELETE CASCADE,
  n             integer NOT NULL,
  status_code   integer,
  duration_ms   integer,
  error         text,
  at            timestamptz NOT NULL,
  UNIQUE (delivery_id, n)
);
```
