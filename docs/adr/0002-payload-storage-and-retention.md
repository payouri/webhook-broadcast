# Persist full inbound payloads; no redaction; global retention

Inbound Broadcasts store the raw body (hard-reject above `INGEST_MAX_BODY_BYTES`, default 1 MiB) and all headers by default, filtered by optional env allow/deny lists. Redaction is out of scope — it is a transform, and transforms are excluded from this effort. History (metadata and payloads together) is kept for `HISTORY_RETENTION_DAYS` (default 30) and pruned by a scheduled delete of old Broadcasts; a Broadcast is replayable for that whole window and not beyond.
