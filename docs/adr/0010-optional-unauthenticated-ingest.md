# Per-Channel opt-in for unauthenticated ingest

`POST /ingest/:slug` requires the Channel's ingest token by default. Some webhook providers offer no way to attach a header at all (e.g. a bare `notify_url` string with no headers/auth block), so they physically cannot authenticate — putting the token in the query string was rejected because inbound requests are persisted (ADR 0002), which would store the credential in every stored request record and access log.

Instead, `Channel.allowUnauthenticatedIngest` (default `false`) lets an operator opt a specific Channel out of the token check. Every existing Channel keeps requiring its token; nothing changes unless an operator flips the flag. When it is on, the slug is the only thing gating that Channel's fan-out — this is documented in the admin UI and API field description, not just here.

Hardening: an open Channel's slug must be at least `MIN_OPEN_INGEST_SLUG_LENGTH` (24) characters, enforced by a Postgres `CHECK` constraint (`channel_open_ingest_slug_length_chk`) so it holds for every write path, not just one validator — and mirrored as a Zod refinement in `@webhook-broadcast/contract` so the admin API returns 400 instead of surfacing the DB error. An unknown slug and a bad token still return the identical 401, so probing `/ingest/:slug` can never distinguish "no such Channel" from "this Channel happens to be open."
