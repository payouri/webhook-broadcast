# Endpoint timeout gains a contract maximum

`timeoutMs` had a positive-integer minimum only, so nothing stopped an operator setting an absurd
per-Endpoint value. ADR 0003 fixes the worker's HTTP timeout default at 10s (overridable per
Endpoint) and its retry backoff at a 5s base up to a 1h cap. A per-Endpoint timeout anywhere near
that 1h cap would let one slow request occupy a worker slot for as long as the retry schedule ever
waits between attempts — every other Delivery queued behind it in the same fan-out stalls too, so
the bound is a fan-out concern, not just "one request runs long." `timeoutMs` therefore gains a
maximum of `3_600_000` (1h), the same value as `DEFAULT_DELIVERY_BACKOFF_MAX_MS`, defined once in
`packages/contract/src/endpoint.ts` as `MAX_ENDPOINT_TIMEOUT_MS` and imported by both the admin API
(which now refuses a larger value) and `apps/web`'s Endpoint form (which refuses it at the field).

**Existing data**: no backfill. The worker reads `timeoutMs` straight off the `endpoints` row and
never re-validates it against the contract schema, so an Endpoint already stored above the new
maximum keeps delivering exactly as before. The admin API only re-checks `timeoutMs` when a
request's payload actually includes that field — `endpointUpdateSchema`'s fields are all optional,
so editing an over-the-cap Endpoint's `name` or `enabled` without touching `timeoutMs` still
succeeds. Only a write that explicitly sets `timeoutMs` above the cap (on that Endpoint or any
other) is refused going forward; an operator who wants an existing outlier brought under the cap
does so by editing it down, same as any other field.
