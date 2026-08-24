# Persist full inbound payloads; no redaction; global retention

Inbound Broadcasts store the raw body (hard-reject above `INGEST_MAX_BODY_BYTES`, default 1 MiB) and all headers by default, filtered by env allow/deny lists. The deny side is not
fully optional: six credential-bearing headers (`authorization`, `cookie`, `set-cookie`,
`proxy-authorization`, `x-api-key`, `x-auth-token`) are always stripped — `INGEST_HEADER_DENYLIST`
is unioned onto that set rather than replacing it, and the denylist is checked before the allowlist,
so no env setting can opt a Channel back into storing them. ADR 0016 treats that floor as
load-bearing: per-Channel forwarding can only select from what was persisted. Redaction is out of scope — it is a transform, and transforms are excluded from this effort. History (metadata and payloads together) is kept for `HISTORY_RETENTION_DAYS` (default 30) and pruned by a scheduled delete of old Broadcasts; a Broadcast is replayable for that whole window and not beyond.
