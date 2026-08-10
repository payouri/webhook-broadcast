# Postgres access layer for webhook-broadcast

**Status:** decided
**Date:** 2026-08-10
**Question:** [#5](https://github.com/payouri/webhook-broadcast/issues/5) — which Postgres access layer and migration tool should the backend use?
**Scope:** Postgres is already the system of record for Channel, Endpoint, Broadcast, **Delivery** (Broadcast×Endpoint; unique on `broadcast_id` + `endpoint_id`), and **Attempt** (one HTTP try). Redis / BullMQ is the queue only ([#3](https://github.com/payouri/webhook-broadcast/issues/3)). Zod is already the contract source of truth via `zod-openapi` ([#4](https://github.com/payouri/webhook-broadcast/issues/4)). This note picks the query layer and how migrations ship.

Domain vocabulary is exact: do **not** call a Delivery an "Attempt". Attempt rows are append-only HTTP tries against a Delivery; inbound body/headers live on Broadcast (ADR 0002) — response bodies are not stored.

Investigated **2026-08-10**. Every version and publish date below was read that day from the npm registry (`https://registry.npmjs.org/<pkg>` dist-tags + `time` map + `dist.unpackedSize`) or from the project's own official docs / GitHub. No secondary write-ups were used.

---

## 1. Recommendation

**Use Drizzle ORM (`drizzle-orm` + `node-postgres` `Pool`) with SQL migrations generated and applied by `drizzle-kit` (`generate` → reviewable `.sql` → `migrate` / programmatic `migrate()` at container deploy). Bridge table shapes to Zod with `drizzle-zod` (Zod 4 peer).**

Concrete package floor as of this write-up:

| Package | Version | Published |
|---|---|---|
| `drizzle-orm` | **0.45.2** | 2026-03-27 |
| `drizzle-kit` | **0.31.10** | 2026-03-17 |
| `drizzle-zod` | **0.8.3** | 2025-08-06 (peers: `zod ^3.25 \|\| ^4`, `drizzle-orm >=0.36`) |
| `pg` | **8.23.0** | 2026-08-08 |
| `zod` | **4.4.3** (already settled) | 2026-05-04 |

Rationale, in the order that decided it:

1. **Zod contract SoT without a second schema language.** We already emit OpenAPI from Zod ([#4](https://github.com/payouri/webhook-broadcast/issues/4)). `drizzle-zod` generates select / insert / update Zod schemas from the same TypeScript table definitions Drizzle uses at runtime, with refinements and `createSchemaFactory({ zodInstance })` so an extended Zod (e.g. OpenAPI-annotated) instance can be reused ([drizzle-zod README](https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-zod/README.md); npm peerDeps on `drizzle-zod@0.8.3`). Official Drizzle docs also document the same helpers under the Zod validation page, including `import { z } from 'zod/v4'` refinements and factory wiring for `@hono/zod-openapi`-style extended instances ([Zod](https://orm.drizzle.team/docs/zod)). Table columns stay one TypeScript source; wire contracts stay Zod picks/extends of those shapes — no Prisma Schema Language, no hand-kept Kysely `Database` interface drifting beside Zod.

2. **Insert-heavy Attempt writes are first-class SQL, not an ORM afterthought.** Multi-row `insert().values([...])` is documented for PostgreSQL; values are parameterized (`$1`, …) automatically ([Insert](https://orm.drizzle.team/docs/insert)). Prepared statements are a first-party performance API: build once with `.prepare("name")`, re-execute with `sql.placeholder(...)` for runtime params ([Queries / prepared statements](https://orm.drizzle.team/docs/perf-queries)). Pooling is the driver's: `import { Pool } from "pg"` then `drizzle({ client: pool })` via `drizzle-orm/node-postgres` ([Get started — existing Postgres](https://orm.drizzle.team/docs/get-started/postgresql-existing)). That matches a BullMQ worker writing Attempt rows at queue rate without introducing a query-engine binary.

3. **Dashboard reads that stop being trivial still keep types.** Keyset/cursor pagination, filtered history, and aggregates (success rate, p95 duration) are ordinary SQL. Drizzle's `sql` / `sql<T>` template parameterizes values, maps table/column refs, and lets you type partial selects (`sql<number>\`count(*)\`.mapWith(Number)`) while still composing into the query builder ([Magic sql`` operator](https://orm.drizzle.team/docs/sql)). Percentile / window SQL we will need for p95 is exactly the escape hatch this project needs — typed at the edges, not boxed into an ORM DSL.

4. **JSON columns match ADR 0002 without ceremony.** `json` / `jsonb` columns take `.$type<T>()` for compile-time insert/select inference (runtime values are not validated by `.$type` itself — pair with Zod refinements for that) ([PostgreSQL column types — json / jsonb](https://orm.drizzle.team/docs/column-types/pg#json--jsonb)). Store inbound body + headers on Broadcast; Attempt holds status / duration / error only.

5. **Migrations are reviewable SQL and container-friendly.** Codebase-first: `drizzle-kit generate` diffs the TypeScript schema against the last snapshot, prompts on renames, and writes `migration.sql` + `snapshot.json` under version control; apply with `drizzle-kit migrate`, with `migrate()` from `drizzle-orm/node-postgres/migrator` at deploy, or hand the SQL to an external runner ([Migrations fundamentals](https://orm.drizzle.team/docs/migrations), [`generate`](https://orm.drizzle.team/docs/drizzle-kit-generate)). Destructive shape changes are visible in the SQL diff in PR review — that is the safety bar we want for a self-hosted single-tenant deploy.

6. **Worker cold-start stays a thin TypeScript layer on `pg`.** `drizzle-orm@0.45.2` unpacks to ~10.4 MB of optional dialect code with peer drivers; there is no separate Rust/WASM query engine to boot per process. Contrast `@prisma/client@7.9.1` at ~78.4 MB unpacked plus the `prisma@7.9.1` CLI package at ~43.8 MB (npm `dist.unpackedSize`, 2026-08-10). A separate BullMQ worker process should open a `pg.Pool` and start querying — same driver the API process uses.

### What we are explicitly not choosing

- **Kysely (+ `kysely-ctl` / `Migrator`)** — best-in-class typed SQL builder and the lightest runtime (~1.7 MB unpacked for `kysely@0.29.5`, published **2026-08-10**), but it loses the Zod bridge and the generate-SQL migration workflow this repo needs (see §4).
- **Prisma (`prisma` / `@prisma/client` 7.9.1)** — excellent Migrate story (`migrate deploy` for CI/prod), but a second schema language fighting Zod SoT, heavier client footprint for the worker, and aggregates like p95 fall straight through to `$queryRaw` anyway (see §5).

### Escape hatches worth knowing

- Drizzle can also **push** schema without SQL files, or **pull** DB-first — we will not use `push` in production; reserved for local throwaways ([Migrations fundamentals](https://orm.drizzle.team/docs/migrations)).
- Official docs show Zod helpers under `drizzle-orm/zod` on an `@rc` install path ([Zod](https://orm.drizzle.team/docs/zod)); stable greenfield today should depend on **`drizzle-zod@0.8.3`** (same API surface, Zod 4 peer). Revisit folding onto `drizzle-orm/zod` when v1 stable lands without the RC pin.
- If we ever need DB-first codegen only, `drizzle-kit pull` exists — not our default.

---

## 2. How the winner maps onto this project's paths

### 2.1 Attempt writes from the BullMQ worker

Shape (illustrative — not production code):

- On ingest accept: one transaction inserts `broadcast`, N `delivery` rows (unique `(broadcast_id, endpoint_id)`), then BullMQ `addBulk` enqueues one job per Delivery ([#3](https://github.com/payouri/webhook-broadcast/issues/3)).
- On each worker run: insert one **Attempt** row (status, duration_ms, error) — append-only; never overwrite.

Drizzle covers the hot path:

| Need | Drizzle answer | Source |
|---|---|---|
| Multi-row insert | `db.insert(deliveries).values([...])` | [Insert — multiple rows](https://orm.drizzle.team/docs/insert) |
| Parameterization | Automatic `$n` placeholders | same |
| Reused Attempt insert | `.prepare("insert_attempt")` + `sql.placeholder` | [Prepared statements](https://orm.drizzle.team/docs/perf-queries) |
| Pooling | `new Pool(...)` from `pg`, passed as `client` | [postgresql-existing](https://orm.drizzle.team/docs/get-started/postgresql-existing) |
| Conflicts on Delivery unique | `onConflictDoNothing` / `onConflictDoUpdate` | [Insert — upserts](https://orm.drizzle.team/docs/insert) |

Note: Drizzle's `db.batch([...])` is documented for the **Neon HTTP** driver, not as a general multi-statement pool API ([Batch API](https://orm.drizzle.team/docs/batch-api)). For node-postgres, use a transaction (`db.transaction`) for ingest fan-out inserts, and multi-row `values([...])` for batches that are a single statement.

### 2.2 Dashboard reads

Admin API already settled opaque cursors + `{ items, nextCursor }` ([ADR 0005](../adr/0005-admin-api-contract.md)). Implementation is keyset/`WHERE (received_at, id) < (...)` SQL — natural in the query builder, or `sql` fragments when the predicate is awkward.

Aggregates (success rate = succeeded Deliveries / total; p95 Attempt duration per Endpoint) belong in SQL (`percentile_cont` / `percentile_disc`, `FILTER (WHERE …)`, etc.). Prefer:

```ts
sql<number>`percentile_cont(0.95) WITHIN GROUP (ORDER BY ${attempts.durationMs})`.mapWith(Number)
```

composed into `db.select({ ... }).from(...).groupBy(...)` rather than pulling rows into Node. The `sql<T>` helper is explicitly "purely a helper for Drizzle" with no runtime mapping unless `.mapWith` is used ([Magic sql``](https://orm.drizzle.team/docs/sql)) — keep Zod parse on the admin response boundary.

### 2.3 Zod interop (avoid dual drift)

Recommended layering for this repo:

1. **Drizzle `pgTable` definitions** = physical schema SoT (columns, nullability, `jsonb`, uniques).
2. **`drizzle-zod`** `createSelectSchema` / `createInsertSchema` / `createUpdateSchema` (+ refinements) = Zod views of those rows for validating DB I/O and seeding admin response pieces.
3. **Hand-authored / picked Zod** in the OpenAPI contract layer remains the **wire** SoT (timestamps as `z.iso.datetime()`, tokens hashed vs plaintext-once, envelopes) — composing from (2) via `.pick` / `.extend` / factory `zodInstance`, not by re-declaring every column.

`drizzle-zod@0.8.3` peers include **`zod@^4`**, so this does not fight the [#4](https://github.com/payouri/webhook-broadcast/issues/4) toolchain.

### 2.4 JSON columns

- Broadcast: `body` (bytea or text — ADR 0002) + `headers jsonb.$type<Record<string, string | string[]>>()` (exact header value shape to be locked at implement time).
- Attempt: no response body column.
- Runtime validation of JSON shapes: Zod refinements on the drizzle-zod schema (`preferences: z.object({...})` overwrite pattern in [Zod docs](https://orm.drizzle.team/docs/zod)), not `.$type` alone.

### 2.5 Migrations & destructive safety

| Step | Command / API | Role |
|---|---|---|
| Author schema change | edit `pgTable` TS | SoT |
| Generate | `drizzle-kit generate` | writes reviewable `migration.sql`; prompts on renames |
| Review | PR diff of `.sql` | catch drops / type rewrites |
| Deploy (container) | `drizzle-kit migrate` **or** `await migrate(db)` from `drizzle-orm/node-postgres/migrator` | apply pending only |
| Local prototype only | `drizzle-kit push` | **not** for prod |

Do **not** auto-apply generated SQL without human review when the diff contains `DROP`, column type rewrites, or unique-constraint rebuilds on Delivery/Attempt. Prefer expand → backfill → contract migrations for anything that can strand history rows under `HISTORY_RETENTION_DAYS`.

### 2.6 Runtime footprint

| Package | `dist.unpackedSize` (npm, 2026-08-10) |
|---|---|
| `drizzle-orm@0.45.2` | ~10.4 MB |
| `kysely@0.29.5` | ~1.7 MB |
| `@prisma/client@7.9.1` | ~78.4 MB |
| `prisma@7.9.1` (CLI / migrate) | ~43.8 MB |
| `pg@8.23.0` | ~0.1 MB |

Drizzle is not the absolute lightest (Kysely wins that axis), but it is an order of magnitude lighter than Prisma Client on disk and has no separate engine bootstrap — decisive for a always-on worker that already pays for BullMQ + ioredis.

---

## 3. Decision matrix (this project only)

| Criterion | **Drizzle + drizzle-kit** | Kysely + Migrator / kysely-ctl | Prisma 7 + Migrate |
|---|---|---|---|
| Batch / multi-row Attempt inserts | First-class `values([...])`, parameterized | First-class multi-row insert on PG ([docs](https://kysely.dev/docs/examples/insert/multiple-rows)) | `createMany` / `createManyAndReturn` ([CRUD](https://www.prisma.io/docs/orm/prisma-client/queries/crud)) |
| Prepared statements | First-party `.prepare` | Relies on driver / repeated compile; thin QB | Driver adapter + engine; not the same "prepare once" DX |
| Pooling | `pg.Pool` as client | `PostgresDialect({ pool: new Pool(...) })` ([Migrations](https://kysely.dev/docs/migrations)) | Prisma 7 **requires** driver adapter (`@prisma/adapter-pg` + `pg`) ([Prisma Client intro](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/introduction)) |
| Keyset + filters + p95 SQL | `sql` / `sql<T>` in-builder | `sql` template / ExpressionBuilder ([Raw SQL](https://kysely.dev/docs/recipes/raw-sql), [Expressions](https://kysely.dev/docs/recipes/expressions)) | `$queryRaw` / TypedSQL recommended over unsafe strings ([Raw queries](https://www.prisma.io/docs/orm/prisma-client/using-raw-sql/raw-queries)); built-in `aggregate`/`groupBy` lack percentile |
| Zod 4 interop | **First-party `drizzle-zod`** | None first-party — hand schemas or community glue | Community Prisma→Zod generators (wrong direction for Zod SoT); Prisma Schema Language is a second SoT |
| JSON / jsonb typing | `jsonb().$type<T>()` | Table interface + helpers (`sql\`CAST … AS JSONB\``) ([Extending Kysely](https://kysely.dev/docs/recipes/extending-kysely)) | `Json` / `Prisma.JsonValue` ([JSON fields](https://www.prisma.io/docs/orm/prisma-client/special-fields-and-types/working-with-json-fields)) |
| Reviewable SQL migrations | **Yes** — `generate` → `migration.sql` | Migrations are **TypeScript** `up`/`down` via schema builder or embedded `sql`; no generate-SQL-from-schema first party ([Migrations](https://kysely.dev/docs/migrations)) | **Yes** — `prisma/migrations/**/migration.sql` + `migrate deploy` ([Migration histories](https://www.prisma.io/docs/orm/prisma-migrate/understanding-prisma-migrate/migration-histories), [Dev & prod](https://www.prisma.io/docs/orm/prisma-migrate/workflows/development-and-production)) |
| Destructive safety | SQL visible in PR; rename prompts on generate | Review TS migrations; easy to miss DDL in noise | `migrate deploy` never resets; `migrate dev`/`reset` are **dev-only** and explicitly must not run in prod |
| Worker cold-start / footprint | Thin TS + `pg` | **Lightest** | Heaviest client unpack; fine for one API, wasteful for a second worker process |

---

## 4. Kysely — why not (for us)

Kysely is excellent software. `kysely@0.29.5` shipped **the day of this write-up**. It is a TypeScript SQL query builder (not an ORM), with compile-time table/column visibility, multi-row inserts, and a `sql` template escape hatch ([README](https://github.com/kysely-org/kysely/blob/master/README.md), [Raw SQL recipe](https://kysely.dev/docs/recipes/raw-sql)).

It fails **this** project's constraints on two hard edges:

1. **No first-party Zod bridge.** Types live in a hand-written `interface Database` or are generated DB-first via `kysely-codegen@0.20.0`. Our contract SoT is Zod → OpenAPI. That leaves three artifacts (Zod wire, Kysely DB interface, SQL DDL) with no official sync tool — exactly the dual-schema drift #5 asks to avoid.
2. **Migrations are TypeScript programs, not generated SQL files.** Official migrations export `up`/`down` using `db.schema.createTable(...)` or ad-hoc `sql`; `Migrator.migrateToLatest()` applies them and documents DB-level locking for concurrent deploys ([Migrations](https://kysely.dev/docs/migrations)). Optional `kysely-ctl@0.21.0` is the CLI ([kysely-ctl README](https://github.com/kysely-org/kysely-ctl/blob/main/README.md)). Reviewable DDL is possible only if authors discipline themselves to raw `sql\`…\`` strings — there is no `generate` that diffs a schema SoT into `migration.sql` the way drizzle-kit / Prisma Migrate do.

Choose Kysely only if we dropped Zod-as-schema-SoT or accepted manual type mirrors. We are not doing that.

---

## 5. Prisma — why not (for us)

Prisma 7.9.1 is current (`@prisma/client` / `prisma` published **2026-07-27**). Migrate is production-competent: `migrate deploy` applies pending SQL in CI/CD, uses advisory locks, does **not** reset or rely on a shadow DB ([Development and production](https://www.prisma.io/docs/orm/prisma-migrate/workflows/development-and-production)). `createMany` / `createManyAndReturn` cover batch inserts on PostgreSQL ([CRUD](https://www.prisma.io/docs/orm/prisma-client/queries/crud)). Prisma 7 requires a driver adapter (`@prisma/adapter-pg` + `pg`) ([Client setup](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/introduction)).

It fails **this** project on the axes that matter more than Migrate:

1. **Schema language vs Zod SoT.** Models live in Prisma Schema Language. Community generators emit Zod *from* Prisma — the opposite of "Zod is the single source of truth" settled on the map. Every admin field would be declared twice (Prisma + Zod) or Zod would be demoted to a generated artifact, undoing [#4](https://github.com/payouri/webhook-broadcast/issues/4).
2. **Dashboard SQL.** Success-rate and p95 queries are raw SQL territory. Prisma's own raw-query docs push TypedSQL / `$queryRaw` for "heavily optimized" or unsupported features ([Raw queries](https://www.prisma.io/docs/orm/prisma-client/using-raw-sql/raw-queries)). At that point we are paying ORM weight to escape the ORM on the read path we care about most after ingest.
3. **Worker footprint.** `@prisma/client` unpacks ~78 MB vs Drizzle's ~10 MB / Kysely's ~1.7 MB (npm, 2026-08-10). Acceptable for a single API process; poor default when the BullMQ worker is a second Node process that mostly inserts Attempt rows.
4. **JSON typing is intentionally loose.** `JsonValue = string | number | boolean | null | JsonObject | JsonArray` ([JSON fields](https://www.prisma.io/docs/orm/prisma-client/special-fields-and-types/working-with-json-fields)) — fine, but Zod still has to refine; Prisma does not remove that work.

Prisma Migrate's SQL files and `migrate deploy` are the one area that matches our ops preference — Drizzle-kit's generate/migrate path covers the same need without the rest of the Prisma tax.

---

## 6. Concrete configuration to implement

```ts
// db.ts — shared by API process and BullMQ worker
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // size: tune separately for API vs worker; do not share one Pool across processes
});

export const db = drizzle({ client: pool, schema });
```

```ts
// schema excerpt — vocabulary exact
export const deliveries = pgTable(
  "delivery",
  { /* broadcastId, endpointId, status, ... */ },
  (t) => [uniqueIndex("delivery_broadcast_endpoint").on(t.broadcastId, t.endpointId)],
);

export const attempts = pgTable("attempt", {
  // one HTTP try; no response body column
});
```

```bash
# authoring
pnpm drizzle-kit generate   # review migration.sql in PR

# container deploy / migrate job
pnpm drizzle-kit migrate
# or: node -e 'await migrate(db)' via drizzle-orm/node-postgres/migrator
```

```ts
// Zod bridge
import { createSelectSchema, createInsertSchema, createSchemaFactory } from "drizzle-zod";
import { z } from "zod"; // Zod 4

export const deliverySelect = createSelectSchema(deliveries);
// wire contracts: pick/extend into zod-openapi schemas (timestamps → z.iso.datetime())
```

Operational rules:

- One `pg.Pool` per process; API and worker are separate processes → separate pools.
- Prepared statements for the Attempt insert path and any hot cursor page query.
- Never run `drizzle-kit push` or a DB reset against shared/prod data.
- Migration job in the deploy pipeline runs to completion before new API/worker replicas take traffic.

---

## 7. Version constraints (as of 2026-08-10)

| Constraint | Detail | Source |
|---|---|---|
| Access layer | **`drizzle-orm@0.45.2`** | npm dist-tag `latest`, time map |
| Migrations CLI | **`drizzle-kit@0.31.10`** | npm |
| Zod bridge | **`drizzle-zod@0.8.3`** (Zod 4 peer) | npm peerDependencies |
| Driver | **`pg@8.23.0`** (`Pool`) via `drizzle-orm/node-postgres` | npm; [postgresql-existing](https://orm.drizzle.team/docs/get-started/postgresql-existing) |
| Zod | **`zod@4.4.3`** (settled by #4) | npm |
| Rejected floor | Kysely `0.29.5` + `kysely-ctl@0.21.0` | npm |
| Rejected floor | Prisma `7.9.1` | npm |
| Node | Whatever the repo already requires for Koa / BullMQ; Drizzle/pg impose no tighter floor relevant here | — |

Drizzle still publishes `1.0.0-rc.*` lines on npm (RC activity through 2026-08-05). Greenfield should stay on **stable `0.45.x` + drizzle-kit 0.31.x** until 1.0 is `latest`; re-check the Zod import path (`drizzle-zod` vs `drizzle-orm/zod`) at that upgrade.

---

## 8. Sources

All primary: official Drizzle / Kysely / Prisma documentation, first-party GitHub READMEs, and npm registry metadata. No secondary blog round-ups.

- Drizzle — [Insert](https://orm.drizzle.team/docs/insert), [Batch API](https://orm.drizzle.team/docs/batch-api), [Magic sql``](https://orm.drizzle.team/docs/sql), [Prepared statements](https://orm.drizzle.team/docs/perf-queries), [Zod](https://orm.drizzle.team/docs/zod), [Migrations](https://orm.drizzle.team/docs/migrations), [`generate`](https://orm.drizzle.team/docs/drizzle-kit-generate), [PostgreSQL column types (json/jsonb)](https://orm.drizzle.team/docs/column-types/pg#json--jsonb), [Get started — existing Postgres](https://orm.drizzle.team/docs/get-started/postgresql-existing), [drizzle-zod README](https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-zod/README.md)
- Kysely — [Intro / README](https://github.com/kysely-org/kysely/blob/master/README.md), [Migrations](https://kysely.dev/docs/migrations), [Multiple-row insert](https://kysely.dev/docs/examples/insert/multiple-rows), [Raw SQL](https://kysely.dev/docs/recipes/raw-sql), [Expressions](https://kysely.dev/docs/recipes/expressions), [Extending Kysely (JSON)](https://kysely.dev/docs/recipes/extending-kysely), [kysely-ctl](https://github.com/kysely-org/kysely-ctl/blob/main/README.md)
- Prisma — [CRUD / createMany](https://www.prisma.io/docs/orm/prisma-client/queries/crud), [Raw queries](https://www.prisma.io/docs/orm/prisma-client/using-raw-sql/raw-queries), [JSON fields](https://www.prisma.io/docs/orm/prisma-client/special-fields-and-types/working-with-json-fields), [Migration histories](https://www.prisma.io/docs/orm/prisma-migrate/understanding-prisma-migrate/migration-histories), [Development and production](https://www.prisma.io/docs/orm/prisma-migrate/workflows/development-and-production), [Client setup (driver adapters)](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/introduction)
- npm registry time + `dist.unpackedSize` maps read 2026-08-10 for `drizzle-orm`, `drizzle-kit`, `drizzle-zod`, `kysely`, `kysely-ctl`, `kysely-codegen`, `@prisma/client`, `prisma`, `pg`, `zod`
