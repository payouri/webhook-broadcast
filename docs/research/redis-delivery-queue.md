# Redis delivery queue for webhook-broadcast

**Status:** decided
**Date:** 2026-08-04
**Question:** [#3](https://github.com/payouri/webhook-broadcast/issues/3) — which Redis mechanism carries the delivery queue, and what delivery guarantees does it give?
**Scope:** accept-then-async is already decided (respond `202` with a broadcast id, fan out from a Redis-backed queue with retries). Postgres is the system of record for broadcast/attempt history; Redis holds the queue and transient state only.

---

## 1. Recommendation

**Use BullMQ v6 on the Redis backend. One job per Attempt (broadcast × endpoint), enqueued with `addBulk`. Require Redis 7.2 or newer; run a single primary, not Redis Cluster.**

Rationale, in the order that decided it:

1. **Delayed retries with per-job backoff state are the core requirement of webhook delivery, and BullMQ is the only option here that has them natively.** BullMQ jobs take `attempts` plus a `backoff` of type `fixed`, `exponential` (`2 ^ (attempts - 1) * delay` ms) or a custom function receiving `attemptsMade`, `type`, `err`, `job`, all with optional `jitter` (0–1) ([Retrying failing jobs](https://docs.bullmq.io/guide/retrying-failing-jobs)). Redis Streams have no delayed-delivery primitive at all — the [Streams data-type docs](https://redis.io/docs/latest/develop/data-types/streams/) document no scheduling mechanism, and the command set (`XADD`/`XREADGROUP`/`XACK`/`XCLAIM`/`XAUTOCLAIM`) contains nothing that defers visibility. Every backoff schedule on Streams has to be hand-built as a sorted set plus a promoter.
2. **Crash recovery is already implemented and is the thing you least want to hand-roll.** BullMQ locks a job on pickup, renews the lock in the background, and a stalled-check sweep moves lock-expired jobs from `active` back to `wait`, or to `failed` once `maxStalledCount` is exceeded ([Stalled Jobs](https://docs.bullmq.io/guide/workers/stalled-jobs)). Since BullMQ 2.0 no separate `QueueScheduler` process is needed for this ([Graceful shutdown](https://docs.bullmq.io/guide/workers/graceful-shutdown)).
3. **It is unambiguously alive.** `bullmq@6.0.7` was published **2026-08-04** — the same day as this write-up — and the repo's most recent commit is 2026-08-04 ([package.json](https://github.com/taskforcesh/bullmq/blob/master/package.json), [releases](https://github.com/taskforcesh/bullmq/releases)). MIT licensed, ~9.2k stars, releases landing several times per week (v6.0.4 through v6.0.7 all between 2026-08-01 and 2026-08-04).
4. **The state transitions we would otherwise write are ~50 audited Lua scripts.** `src/commands/` contains 49 `.lua` files plus an includes directory — `moveToActive`, `moveToDelayed`, `moveToFinished`, `moveStalledJobsToWait`, `retryJob`, `promote`, `extendLock`, `getRateLimitTtl`, and so on ([src/commands](https://github.com/taskforcesh/bullmq/tree/master/src/commands)). `moveToActive-11.lua`'s own header states the invariant we need: *"This operation guarantees that the worker owns the job during the lock expiration time. The worker is responsible of keeping the lock fresh so that no other worker picks this job again."* That is the visibility-timeout machinery, atomic, already tested across five language bindings.
5. **Everything the admin dashboard needs is already exposed.** Per-queue counts and job getters, a `QueueEvents` class implemented over a Redis stream so events survive disconnections (unlike pub/sub), auto-trimmed to ~10,000 events by default via `streams.events.maxLen` ([Events](https://docs.bullmq.io/guide/events)); a built-in Prometheus exporter via `queue.exportPrometheusMetrics()` ([Prometheus](https://docs.bullmq.io/guide/metrics/prometheus)); an OpenTelemetry-shaped `Telemetry` interface ([Telemetry](https://docs.bullmq.io/guide/telemetry)); and an off-the-shelf UI in `bull-board` (last pushed 2026-08-04) if we want one before our own dashboard exists.

### What we are explicitly not choosing

- **Redis Streams + consumer groups** — correct at-least-once semantics, wrong shape for retry scheduling (see §5). Choose it only if we later need multiple independent consumer groups replaying the *same* event log; we don't, because Postgres owns history.
- **Hand-rolled sorted-set queue** — cheapest to start, most expensive to finish (see §6).
- **`bull` v4** — the predecessor. Last release **v4.16.5, 2024-12-18**; BullMQ is the successor from the same authors. Do not start new work on it.
- **`bee-queue`** (v2.0.0, 2025-12-08) — alive and fast, and it does have `.retries(n)`, `.backoff(strategy, delayFactor)`, `.delayUntil()` and stall detection, but delayed retries require `activateDelayedJobs: true` on at least one Queue instance and it schedules near-term delayed jobs in-process with `setTimeout` over a `nearTermWindow` ([bee-queue README](https://github.com/bee-queue/bee-queue#settings)). Fewer moving parts, but also no rate limiting, no dead-letter tooling, no metrics/telemetry surface, and a much thinner ops story.
- **`agenda`** — MongoDB-backed by default (v6 adds a pluggable backend where Redis is only a *notification* channel, not the store) ([agenda README](https://github.com/agenda/agenda#whats-new-in-v6)). Wrong datastore for us.
- **`pg-boss` / `graphile-worker`** — both healthy Postgres-native queues (pg-boss pushed 2026-08-03), but they contradict the standing decision that Redis is the queue. Noted below as an escape hatch.

### Escape hatch worth knowing about

BullMQ v6 ships an optional **PostgreSQL backend** that runs the identical `Queue`/`Worker`/`QueueEvents`/`FlowProducer` API on Postgres 13+ via `createPostgresBackend`, implementing the blocking-wait primitive with `LISTEN`/`NOTIFY` instead of `BZPOPMIN`, with full feature parity including delayed jobs, rate limiting and deduplication ([PostgreSQL backend](https://docs.bullmq.io/guide/postgresql)). Its own docs put processing throughput at roughly 1.5–2× lower than Redis and call the Redis backend "the default and the most battle-tested option". We stay on Redis, but this means **choosing BullMQ does not lock us to operating Redis forever** — dropping Redis later is a constructor argument, not a rewrite. That is a real strategic argument for BullMQ over both Streams and a hand-roll.

---

## 2. Job granularity: one job per **Attempt**, not per Broadcast

One job per `(broadcast_id, endpoint_id)` pair. Argued from failure modes:

**A Broadcast-granular job cannot express partial failure.** If a broadcast fans out to 12 endpoints and endpoint 7 returns 503, the job either fails as a whole — in which case BullMQ's retry re-runs the processor from the top and re-delivers to the 11 endpoints that already succeeded, manufacturing duplicates — or it succeeds while swallowing the failure, in which case there is no retry at all. Avoiding both means storing per-endpoint progress inside the job payload and re-reading it on each attempt: that is re-implementing per-job retry state one level up, which is precisely the thing BullMQ already gives us for free.

**Backoff is a property of an endpoint, not of a broadcast.** A dead endpoint needs exponential backoff over minutes; its 11 healthy siblings need none. A single job carries a single `attempts`/`backoff` pair, so Broadcast granularity forces the slowest, sickest endpoint's schedule onto everyone.

**The stalled-check clock is per job, and Broadcast jobs are long.** `lockDuration` defaults to 30000 ms and the lock is renewed at half that (`lockRenewTime`), with `stalledInterval` also defaulting to 30000 ms ([worker-options.ts](https://github.com/taskforcesh/bullmq/blob/master/src/interfaces/worker-options.ts)). A job doing 12 sequential HTTP calls to endpoints that each time out has a wall-clock duration that scales with N; a crash 11 deliveries in loses all 11. Attempt jobs are bounded by one HTTP timeout, so the blast radius of any single crash is one delivery.

**Concurrency, rate limiting and poison isolation only work per endpoint.** BullMQ's rate limiter is global per queue (`limiter: { max, duration }`, and *"if you have for example 10 workers for one queue with the above settings, still only 10 jobs will be processed by second"*), and `worker.rateLimit(duration)` + `throw Worker.RateLimitError()` returns the current job to `waiting` when a target answers 429 ([Rate limiting](https://docs.bullmq.io/guide/rate-limiting)). That 429-handling pattern is only expressible if the unit of work is a single endpoint call. Note the corollary: per-group (per-customer) rate limiting was **removed in BullMQ v3.0** from the OSS package, so per-endpoint throttling means either separate queues per hot endpoint, an application-level token check, or BullMQ Pro groups.

**The dashboard maps 1:1.** Attempt granularity makes the BullMQ `failed` set a direct mirror of the Postgres `attempt` rows the dashboard already browses, and makes "retry this delivery" a single-job operation.

**The cost, and how it is paid.** N endpoints means N job hashes and N round-trips instead of one. Mitigations, all first-party: enqueue with `addBulk` (one pipelined round trip; BullMQ's own indicative benchmarks put batched+concurrent `addBulk` at ~52,000 jobs/s on Redis versus ~7,500/s for one-at-a-time `add()` — [PostgreSQL backend § indicative numbers](https://docs.bullmq.io/guide/postgresql), Redis column), and set `removeOnComplete` so successful deliveries do not accumulate in Redis, since by default *"all jobs processed by BullMQ will be either completed, or failed and kept forever"* ([Going to production](https://docs.bullmq.io/guide/going-to-production)). History lives in Postgres; Redis keeps only failed jobs plus a small completed window.

**Shape of the ingest path.** The `202` handler must not do unbounded work. Recommended: in one Postgres transaction insert the `broadcast` row and one `attempt` row per subscribed endpoint, then `addBulk` the attempt jobs. If a channel's subscriber count can grow large enough to make that transaction slow, insert the broadcast and enqueue a single small **fan-out job** whose only work is the Postgres insert + `addBulk`; it is idempotent because the attempt jobs use deterministic ids (§3) and the attempt rows have a unique constraint. Do not use the fan-out job to *deliver*.

---

## 3. Duplicate deliveries: bounded, not eliminated

At-least-once is inherent to any crash-recoverable queue, BullMQ included: a worker can complete an HTTP POST and die before `moveToFinished` lands, and the stalled checker will then re-run it. We bound and label duplicates rather than pretending to prevent them.

**Layer 1 — enqueue-time dedup via deterministic job ids.** Set `jobId` to a deterministic string derived from `broadcast_id` and `endpoint_id`. *"Since ids must be unique, if you add a job with an existing id then that job will just be ignored and not added to the queue at all"* ([Job Ids](https://docs.bullmq.io/guide/jobs/job-ids)). Two constraints from the same page, both load-bearing: custom ids **must not contain `:`** (use `-` or `_`), and **must not be all digits**. And one critical caveat: *"Jobs that are removed from the queue (either manually, or when using settings such as `removeOnComplete`/`removeOnFailed`) will not be considered as duplicates"* — so with `removeOnComplete` enabled, id-based dedup protects only against concurrent/pending double-enqueues, **not** against a replay after cleanup. The durable dedup boundary must therefore be a unique index in Postgres on `(broadcast_id, endpoint_id)`, not the Redis job id.

BullMQ also has a richer first-class `deduplication: { id, ttl, extend, replace, keepLastIfActive }` with simple/throttle/debounce modes and a `deduplicated` event ([Deduplication](https://docs.bullmq.io/guide/jobs/deduplication)). We do not need it for correctness here; it is the right tool if we later want to collapse a burst of inbound requests on the same channel.

**Layer 2 — hard cap on redeliveries.** Two independent ceilings, both in `WorkerOptions`:
- `maxStalledCount` (default **1**) — *"Amount of times a job can be recovered from a stalled state to the `wait` state. If this is exceeded, the job is moved to `failed`."*
- `maxStartedAttempts` (default undefined) — *"the maximum number of times a job is allowed to start processing, regardless of whether it completes or fails. Each time a worker picks up the job and begins processing it, the `attemptsStarted` counter is incremented. If this counter reaches `maxStartedAttempts`, the job will be moved to the failed state with an `UnrecoverableError`."*

Set `maxStartedAttempts` explicitly (e.g. `attempts + 2`). It is the only knob that puts an absolute ceiling on how many times a given endpoint can physically receive one broadcast, independent of retry and stall paths. Cite: [worker-options.ts](https://github.com/taskforcesh/bullmq/blob/master/src/interfaces/worker-options.ts).

**Layer 3 — make stalls rare by construction.** A stall is a lock expiry, so the HTTP timeout must be comfortably shorter than `lockDuration`. Rule: `outbound HTTP timeout + serialization margin < lockDuration` (default 30 s). If we allow slow endpoints a 30 s timeout, raise `lockDuration` rather than hope. The stalled docs also warn that CPU-bound work in the processor prevents lock renewal — ours is I/O-bound, which is the good case, but body hashing/signing of large payloads must stay off the hot path.

**Layer 4 — push idempotency to the receiver.** Duplicates cannot be eliminated on our side, so make them detectable on theirs. Send a stable per-delivery idempotency header (derived from `broadcast_id` + `endpoint_id`) plus the broadcast id and a delivery counter, and state at-least-once in the public webhook contract. Every serious webhook producer does this precisely because this problem has no in-queue solution.

**Layer 5 — attempt rows are append-only.** Each *physical* delivery gets its own `attempt` row (keyed by attempt number / `attemptsStarted`), so a duplicate delivery is visible in the dashboard as a duplicate rather than silently overwriting the first. BullMQ's own guidance is that processors should be designed idempotent and kept atomic and simple ([Idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs)).

---

## 4. Worker crash and deploy

**Crash (SIGKILL, OOM, node dies).** The job stays in the `active` set with a lock that is no longer being renewed. Another worker's stalled sweep — running every `stalledInterval` (default 30 s) — moves it back to `wait` for reprocessing, or straight to `failed` if it has already stalled `maxStalledCount` times ([Stalled Jobs](https://docs.bullmq.io/guide/workers/stalled-jobs)). Worst-case recovery latency is therefore on the order of one `stalledInterval`; the production guide states the same, *"these jobs will be marked as stalled and processed automatically when new workers come online (with a waiting time of about 30 seconds by default)"* ([Going to production](https://docs.bullmq.io/guide/going-to-production)). Nothing is lost, and no separate scheduler process is required (BullMQ ≥ 2.0). Consequence: a crash mid-POST can produce one duplicate delivery — handled by §3.

**Deploy (SIGTERM).** `await worker.close()` marks the worker *closing* so it stops fetching new jobs and waits for in-flight jobs to finish or fail; *"This call will not timeout by itself"* ([Graceful shutdown](https://docs.bullmq.io/guide/workers/graceful-shutdown)). Wire it to both `SIGINT` and `SIGTERM` exactly as the production guide shows — SIGTERM being the signal Kubernetes and PM2 send. Two operational requirements follow: the orchestrator's grace period (e.g. Kubernetes `terminationGracePeriodSeconds`) must exceed the outbound HTTP timeout plus margin, otherwise SIGKILL degrades a clean deploy into the crash path; and the docs are explicit that graceful shutdown *"does not guarantee that the jobs will never end up being stalled"*. Attempt-granular jobs make this cheap — the drain window is one HTTP call, not one whole fan-out.

**Redis restart / Redis loss.** BullMQ requires `maxmemory-policy=noeviction` — *"This is the only setting that guarantees the correct behavior of the queues"* — and recommends AOF with roughly 1 s per write ([Going to production](https://docs.bullmq.io/guide/going-to-production)). Because Postgres is the system of record, we get a stronger recovery story than BullMQ alone: a reconciler that scans Postgres for attempts still in a non-terminal state past a threshold and re-enqueues them (deterministic `jobId`, so re-enqueueing a still-pending job is a no-op) makes total Redis loss a recoverable event rather than data loss. Build that reconciler; it is the payoff for having Postgres own history.

**Connection loss.** For `Worker`s set `maxRetriesPerRequest: null` and leave ioredis's offline queue enabled; for the producer-side `Queue` used by the `202` handler, fail fast instead (low `maxRetriesPerRequest`, `enableOfflineQueue: false`) so an HTTP request never hangs on a dead Redis. BullMQ's internal ioredis `retryStrategy` is exponential with a 1 s floor and 20 s ceiling ([Going to production](https://docs.bullmq.io/guide/going-to-production), [Connections](https://docs.bullmq.io/guide/connections)). Also: do not use ioredis's `keyPrefix`, which conflicts with BullMQ's own prefixing ([Connections](https://docs.bullmq.io/guide/connections)).

---

## 5. Redis Streams + consumer groups — what it would have cost

Streams do give a genuinely correct at-least-once core:

- `XREADGROUP` delivers to one consumer per group and records the entry in the group's **Pending Entries List**; entries are not removed on delivery and must be acknowledged with `XACK`. Unacknowledged entries stay in the PEL and can be reclaimed, *"which means messages may be delivered and processed multiple times"* ([Streams](https://redis.io/docs/latest/develop/data-types/streams/)).
- `XAUTOCLAIM key group consumer min-idle-time start [COUNT count] [JUSTID]` is the crash-recovery primitive: it transfers ownership of entries idle longer than `min-idle-time`, with `SCAN`-like cursor semantics, `COUNT` defaulting to 100 and a hard-coded scan bound of `COUNT × 10`, returning `0-0` when the PEL scan completes. Claiming resets idle time, so *"only a single consumer can successfully claim a given pending message at a specific instant of time"*, and claiming increments the delivery counter unless `JUSTID` is given — high delivery counts are the poison-message signal. Since Redis **6.2.0**. Since Redis 7.0 it also prunes PEL entries whose stream entry was trimmed or `XDEL`'d ([XAUTOCLAIM](https://redis.io/docs/latest/commands/xautoclaim/)).

So the visibility timeout is there. What is not there:

1. **No delayed delivery, at all.** Backoff has to be a second structure: a sorted set scored by `run_at`, plus a poller, plus a Lua script to atomically move due members back into the stream, plus leader/duplication handling so multiple pollers don't double-promote. This is the same sorted-set queue as §6, bolted onto Streams — you end up maintaining both.
2. **No per-job retry state beyond a counter.** The PEL gives you a delivery count. Attempt number, last error, next-retry-at, response code all have to live in the entry payload and be rewritten on each retry (i.e. `XADD` a new entry + `XACK` the old one), which changes entry ids and breaks the PEL's own bookkeeping as a source of truth.
3. **PEL growth is your problem.** Trimming the stream (`MAXLEN`/`MINID`, `LIMIT` since 6.2) does not clear the PEL; only `XACK`, `XAUTOCLAIM` on already-trimmed entries (7.0+), or explicit cleanup does. An endpoint that is down for a day leaves a day of pending entries.
4. **No rate limiting, no dead-letter set, no failed set, no metrics, no UI.** All hand-built.
5. **The one genuinely new Streams feature does not solve our problem.** Redis 8.6 added `XADD ... IDMP <pid> <iid>` / `IDMPAUTO <pid>`, described as **at-most-once *production***, with `XCFGSET IDMP-DURATION` (1–86400 s, default 100) and `IDMP-MAXSIZE` (1–10000, default 100), costing 2–5% throughput and <1.5% memory ([Idempotent message processing](https://redis.io/docs/latest/develop/data-types/streams/idempotency/), [Redis 8.6](https://redis.io/docs/latest/develop/whats-new/8-6/)). It deduplicates a *producer's* retried `XADD`, not a *consumer's* repeated processing — the docs say so explicitly, framing it as preventing duplicate entries "when using at-least-once delivery patterns". Our duplicate risk is on the consumer side. Also note the 8.6 known limitation: avoid `IDMP`/`IDMPAUTO` with `appendonly yes` and non-default `aof-use-rdb-preamble no`.
6. **`XNACK` — the requeue-on-failure primitive Streams always lacked — is too new to build on.** `XNACK key group <SILENT|FAIL|FATAL> IDS ...` releases pending entries back to the PEL with delivery time 0 so they are immediately claimable, with `FATAL` pinning the delivery counter to `LLONG_MAX` as a poison marker. **Since 8.8.0**, and the compatibility table marks it **not supported on Redis Software or Redis Cloud** ([XNACK](https://redis.io/docs/latest/commands/xnack/)). Depending on it would pin us to Redis OSS ≥ 8.8 (8.8.1 released 2026-07-23) and rule out managed Redis Enterprise.

Net: Streams would have us re-implement BullMQ's Lua layer, with a strictly worse retry story, to gain a replayable log we don't need because Postgres is the record.

---

## 6. Hand-rolled sorted set — cost reference

The naive version is small: `ZADD queue <run_at_ms> <attempt_id>` to schedule, poll with `ZRANGEBYSCORE queue -inf <now> LIMIT 0 N` + `ZREM` in Lua to claim atomically. Retry = `ZADD` with a later score. That part is genuinely ~30 lines.

What makes it a project:

- **`BZPOPMIN` does not do due-time semantics.** It pops the *minimum-scored* member regardless of whether that score is in the future, and is `O(log N)`, blocking, since Redis 5.0.0 ([BZPOPMIN](https://redis.io/docs/latest/commands/bzpopmin/)). So you cannot block-wait for "the next *due* job"; you either poll on a timer (latency vs. Redis load tradeoff) or pop-and-push-back, which races. BullMQ solves this with a marker key plus `promoteDelayedJobs` inside `moveToActive-11.lua` and a computed `blockUntil` bounded by *"10 seconds is the maximum time a BZPOPMIN can block"* ([worker.ts](https://github.com/taskforcesh/bullmq/blob/master/src/classes/worker.ts)) — a non-obvious design you would have to rediscover.
- **A pop with no visibility timeout loses work on crash.** Once `ZREM` succeeds the job exists only in the worker's memory. To survive a crash you need a second `processing` sorted set scored by lease expiry, a lock token per job, a lock-renewal loop, and a sweeper — i.e. BullMQ's `active` set + `extendLock` + `moveStalledJobsToWait`, rebuilt.
- **Then:** attempt counters, a `failed` set with retention, rate limiting, pause/resume, counts for the dashboard, graceful shutdown, and a test suite that actually exercises the crash windows. BullMQ's equivalent is 49 Lua scripts.

Use as a cost reference only. There is no version of this project where writing it is the right call.

---

## 7. Version and module constraints

| Constraint | Detail | Source |
|---|---|---|
| Redis floor (hard) | BullMQ throws below Redis **5.0.0** — `static minimumVersion = '5.0.0'` | [redis-connection.ts](https://github.com/taskforcesh/bullmq/blob/master/src/classes/redis-connection.ts) |
| Redis floor (recommended) | `static recommendedMinimumVersion = '6.2.0'`; below it BullMQ logs *"It is highly recommended to use a minimum Redis version of 6.2.0"*. Docs: *"BullMQ is full Redis™ compliant with version 6.2.0 or newer."* | [redis-connection.ts](https://github.com/taskforcesh/bullmq/blob/master/src/classes/redis-connection.ts), [Redis™ Compatibility](https://docs.bullmq.io/guide/redis-tm-compatibility) |
| Feature gating above the floor | BullMQ probes capabilities by version: `canDoubleTimeout` needs ≥ 6.0.0, `canBlockFor1Ms` needs ≥ 7.0.8 | [redis-connection.ts](https://github.com/taskforcesh/bullmq/blob/master/src/classes/redis-connection.ts) |
| **Our floor** | **Redis 7.2+**, target 8.x. 7.0.8+ unlocks BullMQ's 1 ms-block path; current supported lines are 6.2.23, 7.2.15, 7.4.10, 8.2.8, 8.4.5, 8.6.5, 8.8.1, 8.10.0 (8.10.0 released 2026-07-29). No reason to floor at a five-year-old line for greenfield. | [redis/redis releases](https://github.com/redis/redis/releases) |
| Redis modules | **None required.** Core data types only (hashes, lists, sorted sets, one stream for events). | — |
| Redis Cluster | Works only with hash tags, because BullMQ needs atomic multi-key operations: `new Queue('cluster', { prefix: '{myprefix}' })` or `new Queue('{cluster}')`. **Recommendation: single primary + replica, not Cluster** — a webhook queue will not be Redis-CPU-bound before it is HTTP-bound, and Cluster only adds slot-pinning constraints. | [Redis Cluster pattern](https://docs.bullmq.io/bull/patterns/redis-cluster) |
| `maxmemory-policy` | Must be `noeviction`. Non-negotiable. | [Going to production](https://docs.bullmq.io/guide/going-to-production) |
| Persistence | AOF recommended, ~1 s per write. | [Going to production](https://docs.bullmq.io/guide/going-to-production) |
| Node.js | BullMQ v6 requires **Node ≥ 14.17.0** (`engines`), so no constraint in practice. | [package.json](https://github.com/taskforcesh/bullmq/blob/master/package.json), [Migrate v5→v6](https://docs.bullmq.io/guide/migrations/migrate-from-v5-to-v6) |
| Redis client | ioredis by default; `createNodeRedisClient` requires `redis >= 5.0.0`; a Bun adapter exists. Do **not** set ioredis `keyPrefix`. | [BullMQ README](https://github.com/taskforcesh/bullmq#readme), [Connections](https://docs.bullmq.io/guide/connections) |
| Redis alternatives | Dragonfly is an officially tested drop-in; AWS MemoryDB and ElastiCache have dedicated guides. Not all Redis-compatible servers are supported. | [Redis™ Compatibility](https://docs.bullmq.io/guide/redis-tm-compatibility) |
| Encryption | Job `data` is stored in clear text — *"The best is to avoid storing sensitive data in the job altogether."* Put the payload in Postgres and carry only ids in the job, or encrypt the payload field. | [Going to production](https://docs.bullmq.io/guide/going-to-production) |

Note if we ever migrate old code: BullMQ v6 removed the legacy repeatable-job APIs (`Queue.add(..., { repeat })`, `getRepeatableJobs`, `removeRepeatable`, `Repeat`) in favour of Job Schedulers, removed `debounce` in favour of deduplication, and made `Queue.resume()` async ([Migrate from v5 to v6](https://docs.bullmq.io/guide/migrations/migrate-from-v5-to-v6)). Greenfield, so we simply start on the v6 API.

---

## 8. Concrete configuration to implement

```ts
// Queue (producer, used by the 202 handler) — fail fast.
new Queue('deliveries', {
  connection: { /* maxRetriesPerRequest: 1, enableOfflineQueue: false */ },
  defaultJobOptions: {
    attempts: 8,
    backoff: { type: 'exponential', delay: 2_000, jitter: 0.5 },
    removeOnComplete: { age: 3_600, count: 1_000 }, // history lives in Postgres
    removeOnFail: { age: 7 * 24 * 3_600 },          // dashboard retry window
  },
});

// one job per attempt, deterministic id (no ':' , not all digits)
await queue.addBulk(
  endpoints.map(e => ({
    name: 'deliver',
    data: { broadcastId, endpointId: e.id },       // payload by reference
    opts: { jobId: `bcast-${broadcastId}-ep-${e.id}` },
  })),
);

// Worker — never fail fast.
new Worker('deliveries', processor, {
  connection: { maxRetriesPerRequest: null },
  concurrency: 25,
  lockDuration: 45_000,        // > outbound HTTP timeout (say 30s) + margin
  maxStalledCount: 1,          // default; bounds stall-driven duplicates
  maxStartedAttempts: 10,      // absolute ceiling on physical deliveries
});
```

Plus: `SIGINT`/`SIGTERM` → `await worker.close()`; grace period > HTTP timeout; `worker.on('error')` and `queue.on('error')` logged; `process.on('uncaughtException'/'unhandledRejection')` handled; `maxmemory-policy=noeviction` and AOF in the compose file; on 429 use `await worker.rateLimit(retryAfterMs)` + `throw Worker.RateLimitError()`; unique index on Postgres `attempt(broadcast_id, endpoint_id)`; and a periodic reconciler that re-enqueues non-terminal attempts from Postgres.

---

## 9. Sources

All primary: official BullMQ documentation and repository source, official Redis command and data-type documentation, and GitHub release/package metadata. No secondary write-ups were used.

- BullMQ docs — [Connections](https://docs.bullmq.io/guide/connections), [Architecture](https://docs.bullmq.io/guide/architecture), [Stalled Jobs](https://docs.bullmq.io/guide/workers/stalled-jobs), [Graceful shutdown](https://docs.bullmq.io/guide/workers/graceful-shutdown), [Retrying failing jobs](https://docs.bullmq.io/guide/retrying-failing-jobs), [Rate limiting](https://docs.bullmq.io/guide/rate-limiting), [Global Concurrency](https://docs.bullmq.io/guide/queues/global-concurrency), [Job Ids](https://docs.bullmq.io/guide/jobs/job-ids), [Deduplication](https://docs.bullmq.io/guide/jobs/deduplication), [Events](https://docs.bullmq.io/guide/events), [Prometheus](https://docs.bullmq.io/guide/metrics/prometheus), [Telemetry](https://docs.bullmq.io/guide/telemetry), [Redis™ Compatibility](https://docs.bullmq.io/guide/redis-tm-compatibility), [Redis Cluster pattern](https://docs.bullmq.io/bull/patterns/redis-cluster), [Idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs), [PostgreSQL backend](https://docs.bullmq.io/guide/postgresql), [Going to production](https://docs.bullmq.io/guide/going-to-production), [Migrate from v5 to v6](https://docs.bullmq.io/guide/migrations/migrate-from-v5-to-v6)
- BullMQ source (`master`, read 2026-08-04) — [package.json](https://github.com/taskforcesh/bullmq/blob/master/package.json), [src/interfaces/worker-options.ts](https://github.com/taskforcesh/bullmq/blob/master/src/interfaces/worker-options.ts), [src/classes/redis-connection.ts](https://github.com/taskforcesh/bullmq/blob/master/src/classes/redis-connection.ts), [src/classes/worker.ts](https://github.com/taskforcesh/bullmq/blob/master/src/classes/worker.ts), [src/commands/moveToActive-11.lua](https://github.com/taskforcesh/bullmq/blob/master/src/commands/moveToActive-11.lua), [src/commands/](https://github.com/taskforcesh/bullmq/tree/master/src/commands)
- Redis docs — [Streams](https://redis.io/docs/latest/develop/data-types/streams/), [XAUTOCLAIM](https://redis.io/docs/latest/commands/xautoclaim/), [XADD](https://redis.io/docs/latest/commands/xadd/), [XNACK](https://redis.io/docs/latest/commands/xnack/), [BZPOPMIN](https://redis.io/docs/latest/commands/bzpopmin/), [Idempotent message processing](https://redis.io/docs/latest/develop/data-types/streams/idempotency/), [Redis 8.6](https://redis.io/docs/latest/develop/whats-new/8-6/)
- Release/maintenance metadata via GitHub API, 2026-08-04 — bullmq v6.0.7 (2026-08-04), bull v4.16.5 (2024-12-18), bee-queue v2.0.0 (2025-12-08), pg-boss (pushed 2026-08-03), graphile-worker (pushed 2026-07-08), agenda (pushed 2026-07-21), bull-board (pushed 2026-08-04), redis 8.10.0 (2026-07-29)
