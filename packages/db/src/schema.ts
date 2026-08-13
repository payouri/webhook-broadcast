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
} from "drizzle-orm/pg-core";

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

export const channels = pgTable("channel", {
  id: uuid("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  enabled: boolean("enabled").notNull().default(true),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

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
      .references(() => endpoints.id),
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
    statusCode: integer("status_code"),
    durationMs: integer("duration_ms"),
    error: text("error"),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("attempt_delivery_id_n_key").on(t.deliveryId, t.n)],
);
