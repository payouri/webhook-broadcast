import { isNull, sql } from "drizzle-orm";
import {
  pgEnum,
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
  integer,
  customType,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";

/**
 * Issue #38: an open (unauthenticated-ingest) Channel has nothing but its
 * slug standing between the public and its fan-out, so the slug must not be
 * short/guessable in that mode. Enforced as a DB check so it holds across
 * every write path (create and update), not just one validator.
 */
export const MIN_OPEN_INGEST_SLUG_LENGTH = 24;

/** Drizzle has no built-in `bytea` helper; ADR 0002 stores the inbound body raw. */
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const deliveryStatus = pgEnum("delivery_status", [
  "pending",
  "in_progress",
  "succeeded",
  "failed",
  "dead_lettered",
]);

export const channels = pgTable(
  "channel",
  {
    id: uuid("id").primaryKey(),
    slug: text("slug").notNull(),
    description: text("description"),
    enabled: boolean("enabled").notNull().default(true),
    /**
     * Issue #37: allow-listed inbound header names forwarded to every
     * Endpoint on delivery. Empty by default (current behaviour unchanged).
     * Case-insensitive names; "authorization" is never forwarded even if
     * present here (ADR 0002's ingest token lives there).
     */
    forwardHeaders: jsonb("forward_headers").notNull().default([]).$type<string[]>(),
    /**
     * Issue #38: opt-in per Channel to accept `POST /ingest/:slug` without
     * an ingest token. Off by default — every existing Channel keeps
     * requiring its token. When on, the slug alone gates the fan-out.
     */
    allowUnauthenticatedIngest: boolean("allow_unauthenticated_ingest").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    // A CHECK constraint's expression is fixed DDL, not a parameterized
    // query — `sql.raw` inlines the length literal instead of binding it,
    // which `drizzle-kit generate` cannot do for a CHECK clause.
    check(
      "channel_open_ingest_slug_length_chk",
      sql`NOT ${t.allowUnauthenticatedIngest} OR length(${t.slug}) >= ${sql.raw(String(MIN_OPEN_INGEST_SLUG_LENGTH))}`,
    ),
    /**
     * Issue #35: uniqueness is scoped to live Channels only, so a slug is
     * reclaimable after soft-delete. Every slug lookup path already filters
     * `deleted_at IS NULL`, so a live row beside dead ones is unambiguous.
     */
    uniqueIndex("channel_slug_active_key").on(t.slug).where(isNull(t.deletedAt)),
  ],
);

export const channelTokens = pgTable(
  "channel_token",
  {
    id: uuid("id").primaryKey(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id),
    tokenHash: text("token_hash").notNull().unique(),
    prefix: text("prefix").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("channel_token_channel_id_idx").on(t.channelId)],
);

/**
 * Mirrors `channel_token` (ADR 0005) but for admin/operator callers instead
 * of Channel senders: hashed at rest, unique hash, minted/revoked through the
 * admin API, plaintext returned exactly once. `OPERATOR_API_KEY` remains a
 * bootstrap credential outside this table so a fresh deployment can mint the
 * first row (see issue #41).
 */
export const operatorTokens = pgTable("operator_token", {
  id: uuid("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  prefix: text("prefix").notNull(),
  label: text("label").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

export const endpoints = pgTable(
  "endpoint",
  {
    id: uuid("id").primaryKey(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id),
    name: text("name"),
    url: text("url").notNull(),
    timeoutMs: integer("timeout_ms"),
    headers: jsonb("headers").notNull().default({}).$type<Record<string, string>>(),
    enabled: boolean("enabled").notNull().default(true),
    autoDisabledAt: timestamp("auto_disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("endpoint_channel_id_url_key").on(t.channelId, t.url),
    index("endpoint_channel_id_idx").on(t.channelId),
  ],
);

export const broadcasts = pgTable(
  "broadcast",
  {
    id: uuid("id").primaryKey(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    contentType: text("content_type").notNull(),
    body: bytea("body").notNull(),
    headers: jsonb("headers").notNull().default({}).$type<Record<string, string | string[]>>(),
  },
  (t) => [
    index("broadcast_channel_received_id_idx").on(t.channelId, t.receivedAt.desc(), t.id.desc()),
    index("broadcast_received_at_idx").on(t.receivedAt),
  ],
);

export const deliveries = pgTable(
  "delivery",
  {
    id: uuid("id").primaryKey(),
    broadcastId: uuid("broadcast_id")
      .notNull()
      .references(() => broadcasts.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => endpoints.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id),
    status: deliveryStatus("status").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastStatusCode: integer("last_status_code"),
    lastDurationMs: integer("last_duration_ms"),
    lastError: text("last_error"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("delivery_broadcast_endpoint_key").on(t.broadcastId, t.endpointId),
    index("delivery_broadcast_id_idx").on(t.broadcastId),
    index("delivery_endpoint_updated_idx").on(t.endpointId, t.updatedAt.desc()),
  ],
);

export const attempts = pgTable(
  "attempt",
  {
    id: uuid("id").primaryKey(),
    deliveryId: uuid("delivery_id")
      .notNull()
      .references(() => deliveries.id, { onDelete: "cascade" }),
    n: integer("n").notNull(),
    /**
     * Issue #34 — expand step of a rename campaign for the cryptic `n`
     * column (app code already calls this `attemptNumber`, see
     * `apps/api/src/worker/processDeliveryJob.ts`). Nullable and unbacked by
     * app code for now: migration `0004_…` only adds the column and backfills
     * the rows that existed when it ran, so every row written since is NULL
     * here. Do not read this column as a source of truth — `n` stays
     * authoritative until a later, independent deploy starts dual-writing it,
     * a sweep fills the rows written in between, and only then a *separate*
     * contract migration drops `n` and makes this `NOT NULL`. See the
     * expand/contract checklist in `docs/adr/0011-expand-contract-migrations.md`.
     */
    attemptNumber: integer("attempt_number"),
    statusCode: integer("status_code"),
    durationMs: integer("duration_ms"),
    error: text("error"),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("attempt_delivery_id_n_key").on(t.deliveryId, t.n),
    uniqueIndex("attempt_delivery_id_attempt_number_key").on(t.deliveryId, t.attemptNumber),
  ],
);
