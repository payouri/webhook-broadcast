# webhook-broadcast

A single-tenant webhook multiplexer: an inbound HTTP request on a named Channel is fanned out to every Endpoint subscribed to that Channel, with each Delivery recorded for the admin dashboard.

## Language

**Channel**:
The named fan-out group. Identified by an opaque UUID (durable primary key) and a unique slug used in `POST /ingest/:slug`. The slug may be renamed; history stays keyed by id. Carries ingest token(s), an `enabled` flag, an optional description, and soft-delete via `deletedAt`.
_Avoid_: topic, webhook, queue

**Endpoint**:
A subscribed target URL owned by exactly one Channel. Carries `url`, optional `name`, `timeoutMs` (falls back to a global default), extra outbound `headers`, and an `enabled` flag. Outbound method is always `POST`. `(channelId, url)` is unique.
_Avoid_: subscriber, destination, webhook, target

**Broadcast**:
The record of one inbound request accepted on a Channel. Identified by an opaque UUID returned in the `202` response. Stores `channelId`, `receivedAt`, `contentType`, and the raw body. Fan-out targets are the Endpoints enabled on that Channel at accept time.
_Avoid_: event, message, job, request (alone)

**Delivery**:
The unit of work for one Broadcast × one Endpoint. Exactly one per pair — unique on `(broadcastId, endpointId)`. Lifecycle: `pending` → `in_progress` → `succeeded` | `failed` (non-retryable response) | `dead_lettered` (retries exhausted). What the dashboard lists. Per-Endpoint completion order is not guaranteed.
_Avoid_: job, task, message

**Attempt**:
One HTTP try against a Delivery. Stores status code, duration, and error message — not the response body.
_Avoid_: try, call, request (alone)
