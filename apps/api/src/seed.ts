/**
 * Dev-only fixture loader. Fills a migrated database with a hand-shaped set of
 * Channels, Endpoints, Broadcasts, Deliveries and Attempts so the dashboard can
 * be looked at with realistic content instead of empty tables — every UI state
 * the admin surfaces (healthy fan-out, retries, dead letters, an auto-disabled
 * Endpoint, an in-flight backlog, a disabled Channel, an open-ingest Channel, a
 * soft-deleted Channel, and a brand-new empty Channel) is represented.
 *
 * Rows are written straight through Drizzle rather than through the repositories
 * so timestamps can be backdated; the shapes still mirror what the worker writes
 * (see `worker/processDelivery.ts` — `attempt.n` is authoritative, the expand
 * column `attempt_number` stays NULL per ADR 0011).
 *
 * Usage (from the repo root, after `pnpm run migrate`):
 *
 *   pnpm run seed            # reset this script's own rows, then reseed
 *   pnpm run seed -- --clean # only remove this script's own rows
 *
 * All fixture ids are derived from a fixed PRNG seed, so reseeding reuses the
 * same UUIDs (bookmarked dashboard URLs keep working) and a reset can delete
 * exactly the fixture rows without touching anything an operator created by
 * hand. Token plaintexts are the one exception: they come from `crypto` and are
 * printed once per run, because only their hash is ever stored.
 */

import { inArray } from "drizzle-orm";
import { createDb, schema } from "@webhook-broadcast/db";
import { bootMigrateEnv } from "./config.js";
import { mintChannelToken, mintOperatorToken } from "./tokens.js";

const SEED = 0x5eed_1234;

/** Deterministic PRNG (mulberry32) — reruns must produce identical ids. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = createRandom(SEED);

/** v4-shaped UUID drawn from the seeded PRNG, not `crypto.randomUUID`. */
function uuid(): string {
  const bytes = Buffer.alloc(16);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Math.floor(random() * 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function intBetween(min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

function pick<T>(values: readonly T[]): T {
  return values[Math.floor(random() * values.length)]!;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const now = Date.now();
const at = (msAgo: number): Date => new Date(now - msAgo);

/**
 * How an Endpoint behaves under fan-out. Drives Delivery status, Attempt count
 * and latency, which is what the dashboard's health column and status badges
 * are computed from.
 */
type Profile =
  | "healthy" // near-always 2xx on the first Attempt
  | "flaky" // mostly succeeds, sometimes after retries, occasionally dead-letters
  | "slow" // succeeds, but latency dominates the p95
  | "rejecting" // non-retryable 4xx — `failed`, never retried
  | "dead" // connection refused until retries are exhausted
  | "backlogged"; // healthy history, newest Broadcasts still pending/in_progress

interface EndpointFixture {
  name: string | null;
  url: string;
  profile: Profile;
  timeoutMs?: number;
  headers?: Record<string, string>;
  /** Set for the auto-disabled Endpoint: no fan-out after this instant. */
  autoDisabledMsAgo?: number;
}

interface ChannelFixture {
  slug: string;
  description: string | null;
  enabled?: boolean;
  forwardHeaders?: string[];
  allowUnauthenticatedIngest?: boolean;
  deletedMsAgo?: number;
  tokens?: number;
  broadcasts: number;
  /** Oldest Broadcast age; the rest are spread from here up to ~5 minutes ago. */
  historyDays: number;
  payload: (index: number) => { contentType: string; body: unknown };
  endpoints: EndpointFixture[];
}

const CHANNELS: ChannelFixture[] = [
  {
    slug: "stripe-prod",
    description: "Production Stripe events, fanned out to billing and the data warehouse.",
    forwardHeaders: ["stripe-signature", "x-request-id"],
    tokens: 2,
    broadcasts: 64,
    historyDays: 12,
    payload: (index) => ({
      contentType: "application/json",
      body: {
        id: `evt_1P${String(index).padStart(6, "0")}`,
        type: pick([
          "invoice.paid",
          "invoice.payment_failed",
          "customer.subscription.updated",
          "charge.refunded",
        ]),
        created: Math.floor((now - index * HOUR) / 1000),
        data: {
          object: {
            id: `in_1P${String(index).padStart(6, "0")}`,
            customer: `cus_${String(intBetween(100000, 999999))}`,
            amount_due: intBetween(900, 48000),
            currency: "eur",
          },
        },
      },
    }),
    endpoints: [
      {
        name: "billing-service",
        url: "https://billing.internal.acme.dev/hooks/stripe",
        profile: "healthy",
        headers: { "x-internal-auth": "svc-billing" },
      },
      {
        name: "warehouse ingest",
        url: "https://ingest.warehouse.acme.dev/v2/stripe",
        profile: "slow",
        timeoutMs: 15_000,
      },
      {
        name: "ops Slack relay",
        url: "https://hooks.slack.com/services/T0000/B0000/stripe-relay",
        profile: "flaky",
      },
      {
        name: null,
        url: "https://legacy-erp.acme.dev/webhook/stripe",
        profile: "rejecting",
      },
    ],
  },
  {
    slug: "github-webhooks",
    description: "Repo events for CI mirrors and the release bot.",
    forwardHeaders: ["x-github-event", "x-github-delivery"],
    tokens: 1,
    broadcasts: 22,
    historyDays: 6,
    payload: (index) => ({
      contentType: "application/json",
      body: {
        action: pick(["opened", "synchronize", "closed", "labeled"]),
        number: 400 + index,
        pull_request: {
          id: 1_800_000 + index,
          title: pick([
            "fix(worker): clamp backoff to the configured cap",
            "feat(web): endpoint health column",
            "chore(deps): bump drizzle-orm",
          ]),
          head: { sha: `${uuid().replace(/-/g, "").slice(0, 40)}` },
        },
        repository: { full_name: "acme/webhook-broadcast" },
      },
    }),
    endpoints: [
      {
        name: "release-bot",
        url: "https://release-bot.acme.dev/github",
        profile: "healthy",
      },
      {
        name: "ci mirror (decommissioned host)",
        url: "https://ci-mirror.old-dc.acme.dev/github",
        profile: "dead",
        autoDisabledMsAgo: 3 * HOUR,
      },
      {
        name: "audit log",
        url: "https://audit.internal.acme.dev/sink/github",
        profile: "flaky",
      },
    ],
  },
  {
    slug: "shopify-orders",
    description: "Store order lifecycle. Fulfilment is catching up after an incident.",
    forwardHeaders: ["x-shopify-topic"],
    tokens: 1,
    broadcasts: 14,
    historyDays: 3,
    payload: (index) => ({
      contentType: "application/json",
      body: {
        id: 5_100_000_000 + index,
        order_number: 1200 + index,
        financial_status: pick(["paid", "pending", "refunded"]),
        total_price: (intBetween(1500, 42000) / 100).toFixed(2),
        currency: "EUR",
        line_items: [{ sku: `SKU-${intBetween(1000, 9999)}`, quantity: intBetween(1, 4) }],
      },
    }),
    endpoints: [
      {
        name: "fulfilment",
        url: "https://fulfilment.acme.dev/orders",
        profile: "backlogged",
      },
      {
        name: "analytics",
        url: "https://analytics.acme.dev/collect/orders",
        profile: "healthy",
      },
    ],
  },
  {
    slug: "internal-alerts",
    description: "Paused while the on-call rotation is reworked.",
    enabled: false,
    tokens: 1,
    broadcasts: 6,
    historyDays: 20,
    payload: () => ({
      contentType: "application/json",
      body: {
        alertname: pick(["HighErrorRate", "QueueDepth", "DiskPressure"]),
        severity: pick(["warning", "critical"]),
        summary: "p95 delivery latency above 5s for 10m",
      },
    }),
    endpoints: [
      { name: "pagerduty", url: "https://events.pagerduty.com/v2/enqueue", profile: "healthy" },
    ],
  },
  {
    // Issue #38: open ingest requires a long, unguessable slug — the DB CHECK
    // enforces MIN_OPEN_INGEST_SLUG_LENGTH, so this fixture shows what such a
    // slug looks like in the navigator and in the ingest URL.
    slug: "public-intake-8f2c41d7a95b46e0b3c9",
    description: "Unauthenticated intake for the marketing site's contact form.",
    allowUnauthenticatedIngest: true,
    tokens: 0,
    broadcasts: 9,
    historyDays: 4,
    payload: (index) => ({
      contentType: "application/x-www-form-urlencoded",
      body: `name=Visitor+${index}&email=visitor${index}%40example.com&message=Interested+in+pricing`,
    }),
    endpoints: [
      { name: "CRM lead sink", url: "https://crm.acme.dev/leads/inbound", profile: "healthy" },
      { name: "spam scorer", url: "https://spam.acme.dev/score", profile: "flaky" },
    ],
  },
  {
    // Issue #35: soft-deleted Channels release their slug but keep history
    // keyed by id — useful for checking that deleted Channels stay out of the
    // navigator while their Broadcast rows survive retention.
    slug: "legacy-sync",
    description: "Retired after the ERP migration.",
    deletedMsAgo: 2 * DAY,
    tokens: 1,
    broadcasts: 4,
    historyDays: 25,
    payload: () => ({
      contentType: "application/json",
      body: { op: "sync", table: "customers", rows: intBetween(10, 400) },
    }),
    endpoints: [{ name: "erp bridge", url: "https://erp.acme.dev/sync", profile: "healthy" }],
  },
  {
    slug: "blank-canvas",
    description: null,
    tokens: 0,
    broadcasts: 0,
    historyDays: 1,
    payload: () => ({ contentType: "application/json", body: {} }),
    endpoints: [],
  },
];

const INBOUND_HEADERS: Record<string, Record<string, string>> = {
  "stripe-prod": {
    "content-type": "application/json",
    "stripe-signature": "t=1700000000,v1=5d41402abc4b2a76b9719d911017c592",
    "user-agent": "Stripe/1.0 (+https://stripe.com/docs/webhooks)",
    "x-request-id": "req_9f2b7c",
  },
  "github-webhooks": {
    "content-type": "application/json",
    "x-github-event": "pull_request",
    "x-github-delivery": "72d3162e-cc78-11e3-81ab-4c9367dc0958",
    "user-agent": "GitHub-Hookshot/044aadd",
  },
  "shopify-orders": {
    "content-type": "application/json",
    "x-shopify-topic": "orders/updated",
    "user-agent": "Shopify Captain Hook",
  },
};

interface AttemptSpec {
  statusCode: number | null;
  durationMs: number;
  error: string | null;
}

interface Outcome {
  status: (typeof schema.deliveryStatus.enumValues)[number];
  attempts: AttemptSpec[];
}

const TRANSIENT_CODES = [502, 503, 504, 429] as const;

function transientAttempt(): AttemptSpec {
  const statusCode = pick(TRANSIENT_CODES);
  return {
    statusCode,
    durationMs: intBetween(120, 2400),
    error: `upstream responded ${statusCode}`,
  };
}

function outcomeFor(profile: Profile, timeoutMs: number, recentIndex: number | null): Outcome {
  switch (profile) {
    case "healthy": {
      if (random() < 0.94) {
        return {
          status: "succeeded",
          attempts: [{ statusCode: 200, durationMs: intBetween(35, 190), error: null }],
        };
      }
      return {
        status: "succeeded",
        attempts: [
          transientAttempt(),
          { statusCode: 200, durationMs: intBetween(45, 220), error: null },
        ],
      };
    }
    case "flaky": {
      const roll = random();
      if (roll < 0.68) {
        return {
          status: "succeeded",
          attempts: [{ statusCode: 200, durationMs: intBetween(80, 640), error: null }],
        };
      }
      if (roll < 0.9) {
        const retries = intBetween(1, 3);
        return {
          status: "succeeded",
          attempts: [
            ...Array.from({ length: retries }, transientAttempt),
            { statusCode: 200, durationMs: intBetween(90, 700), error: null },
          ],
        };
      }
      return {
        status: "dead_lettered",
        attempts: Array.from({ length: 8 }, transientAttempt),
      };
    }
    case "slow": {
      if (random() < 0.12) {
        const timedOut: AttemptSpec = {
          statusCode: null,
          durationMs: timeoutMs,
          error: `request timed out after ${timeoutMs}ms`,
        };
        return { status: "dead_lettered", attempts: Array.from({ length: 8 }, () => timedOut) };
      }
      return {
        status: "succeeded",
        attempts: [
          {
            statusCode: 200,
            durationMs: intBetween(1400, Math.max(1500, timeoutMs - 900)),
            error: null,
          },
        ],
      };
    }
    case "rejecting": {
      const statusCode = pick([400, 401, 404, 422] as const);
      return {
        status: "failed",
        attempts: [
          {
            statusCode,
            durationMs: intBetween(25, 140),
            error: `upstream responded ${statusCode} (non-retryable)`,
          },
        ],
      };
    }
    case "dead": {
      return {
        status: "dead_lettered",
        attempts: Array.from({ length: 8 }, () => ({
          statusCode: null,
          durationMs: intBetween(20, 120),
          error: "connect ECONNREFUSED 10.4.2.11:443",
        })),
      };
    }
    case "backlogged": {
      if (recentIndex === null) {
        return outcomeFor("healthy", timeoutMs, null);
      }
      // The newest Broadcasts are still moving through the queue. Both in-flight
      // states are pinned rather than rolled so the badge for each one is always
      // on screen: neither `pending` nor `in_progress` has a finished Attempt.
      return recentIndex === 0
        ? { status: "in_progress", attempts: [] }
        : { status: "pending", attempts: [] };
    }
  }
}

interface Totals {
  channels: number;
  endpoints: number;
  broadcasts: number;
  deliveries: number;
  attempts: number;
}

async function main(): Promise<void> {
  const env = bootMigrateEnv();
  const clean = process.argv.includes("--clean");
  const { db, pool } = createDb(env.DATABASE_URL);

  try {
    // Ids are assigned in one deterministic pass first, so both the reset and
    // the insert work from the same id set.
    const channelPlans = CHANNELS.map((fixture) => ({
      fixture,
      id: uuid(),
      tokenIds: Array.from({ length: fixture.tokens ?? 1 }, () => uuid()),
      endpointIds: fixture.endpoints.map(() => uuid()),
    }));
    const channelIds = channelPlans.map((plan) => plan.id);
    const operatorTokenPlans = [
      { id: uuid(), label: "youri — laptop", lastUsedMsAgo: 12 * MINUTE },
      { id: uuid(), label: "terraform (ci)", lastUsedMsAgo: 2 * DAY },
      { id: uuid(), label: "incident runbook (unused)", lastUsedMsAgo: null },
    ];

    await resetFixtures(
      db,
      channelIds,
      operatorTokenPlans.map((plan) => plan.id),
    );
    if (clean) {
      console.log(`removed fixture rows for ${channelIds.length} channels`);
      return;
    }

    const totals: Totals = {
      channels: 0,
      endpoints: 0,
      broadcasts: 0,
      deliveries: 0,
      attempts: 0,
    };
    const mintedTokens: { channel: string; token: string }[] = [];

    for (const plan of channelPlans) {
      const { fixture } = plan;
      const createdAt = at(fixture.historyDays * DAY + 6 * HOUR);

      await db.insert(schema.channels).values({
        id: plan.id,
        slug: fixture.slug,
        description: fixture.description,
        enabled: fixture.enabled ?? true,
        forwardHeaders: fixture.forwardHeaders ?? [],
        allowUnauthenticatedIngest: fixture.allowUnauthenticatedIngest ?? false,
        deletedAt: fixture.deletedMsAgo === undefined ? null : at(fixture.deletedMsAgo),
        createdAt,
        updatedAt: at(intBetween(1, 48) * HOUR),
      });
      totals.channels += 1;

      for (const [index, tokenId] of plan.tokenIds.entries()) {
        const minted = mintChannelToken();
        await db.insert(schema.channelTokens).values({
          id: tokenId,
          channelId: plan.id,
          tokenHash: minted.tokenHash,
          prefix: minted.prefix,
          createdAt: at(fixture.historyDays * DAY - index * HOUR),
        });
        mintedTokens.push({ channel: fixture.slug, token: minted.token });
      }

      const endpointRows = fixture.endpoints.map((endpoint, index) => {
        const autoDisabledAt =
          endpoint.autoDisabledMsAgo === undefined ? null : at(endpoint.autoDisabledMsAgo);
        return {
          id: plan.endpointIds[index]!,
          channelId: plan.id,
          name: endpoint.name,
          url: endpoint.url,
          timeoutMs: endpoint.timeoutMs ?? null,
          headers: endpoint.headers ?? {},
          // ADR 0003: auto-disable flips `enabled` off and stamps the instant.
          enabled: autoDisabledAt === null,
          autoDisabledAt,
          createdAt,
          updatedAt: autoDisabledAt ?? createdAt,
        };
      });
      if (endpointRows.length > 0) {
        await db.insert(schema.endpoints).values(endpointRows);
        totals.endpoints += endpointRows.length;
      }

      const span = fixture.historyDays * DAY - 5 * MINUTE;
      let previousBody: { contentType: string; body: Buffer } | null = null;

      for (let index = 0; index < fixture.broadcasts; index += 1) {
        // Newest first, easing toward now so the last 24h — the window the
        // Endpoint health column reads — is densely populated.
        const progress = fixture.broadcasts === 1 ? 0 : index / (fixture.broadcasts - 1);
        const receivedAt = at(5 * MINUTE + Math.round(span * progress ** 2));
        const recentIndex = index < 2 ? index : null;

        const payload = fixture.payload(index);
        const body = Buffer.from(
          typeof payload.body === "string" ? payload.body : JSON.stringify(payload.body, null, 2),
          "utf8",
        );
        // A Replay accepts a brand-new Broadcast carrying the stored body of an
        // older one, so an identical body/contentType pair is exactly what one
        // looks like in the activity list. Index 1 replays index 2.
        const isReplay = index === 1 && previousBody !== null;
        const broadcastId = uuid();

        await db.insert(schema.broadcasts).values({
          id: broadcastId,
          channelId: plan.id,
          receivedAt,
          contentType: isReplay ? previousBody!.contentType : payload.contentType,
          body: isReplay ? previousBody!.body : body,
          headers: INBOUND_HEADERS[fixture.slug] ?? { "content-type": payload.contentType },
        });
        totals.broadcasts += 1;
        previousBody = { contentType: payload.contentType, body };

        for (const [endpointIndex, endpoint] of fixture.endpoints.entries()) {
          const endpointRow = endpointRows[endpointIndex]!;
          // A disabled Endpoint is not in the fan-out snapshot taken at accept
          // time, so it has no Deliveries after it was disabled.
          if (endpointRow.autoDisabledAt !== null && receivedAt > endpointRow.autoDisabledAt) {
            continue;
          }

          const timeoutMs = endpointRow.timeoutMs ?? 10_000;
          const outcome = outcomeFor(endpoint.profile, timeoutMs, recentIndex);
          const deliveryId = uuid();

          let cursor = receivedAt.getTime() + intBetween(40, 900);
          const attemptRows = outcome.attempts.map((attempt, n) => {
            // Retries back off exponentially from a 5s base (ADR 0003), which
            // is what pushes a dead-lettered Delivery's tail hours past accept.
            cursor += attempt.durationMs + (n === 0 ? 0 : Math.min(5_000 * 2 ** (n - 1), HOUR));
            return {
              id: uuid(),
              deliveryId,
              n: n + 1,
              statusCode: attempt.statusCode,
              durationMs: attempt.durationMs,
              error: attempt.error,
              at: new Date(cursor),
            };
          });
          const last = outcome.attempts.at(-1) ?? null;

          await db.insert(schema.deliveries).values({
            id: deliveryId,
            broadcastId,
            endpointId: endpointRow.id,
            channelId: plan.id,
            status: outcome.status,
            attemptCount: outcome.status === "in_progress" ? 1 : outcome.attempts.length,
            lastStatusCode: last?.statusCode ?? null,
            lastDurationMs: last?.durationMs ?? null,
            lastError: outcome.status === "succeeded" ? null : (last?.error ?? null),
            updatedAt: new Date(cursor),
          });
          totals.deliveries += 1;

          if (attemptRows.length > 0) {
            await db.insert(schema.attempts).values(attemptRows);
            totals.attempts += attemptRows.length;
          }
        }
      }
    }

    const mintedOperatorTokens: { label: string; token: string }[] = [];
    for (const plan of operatorTokenPlans) {
      const minted = mintOperatorToken();
      await db.insert(schema.operatorTokens).values({
        id: plan.id,
        tokenHash: minted.tokenHash,
        prefix: minted.prefix,
        label: plan.label,
        createdAt: at(9 * DAY),
        lastUsedAt: plan.lastUsedMsAgo === null ? null : at(plan.lastUsedMsAgo),
      });
      mintedOperatorTokens.push({ label: plan.label, token: minted.token });
    }

    report(totals, channelPlans, mintedTokens, mintedOperatorTokens);
  } finally {
    await pool.end();
  }
}

/**
 * Removes only rows this script owns, keyed by its deterministic ids. Deletes
 * bottom-up: `delivery.channel_id` has no cascade, so Deliveries must go before
 * their Channel (Attempts cascade from Deliveries).
 */
async function resetFixtures(
  db: ReturnType<typeof createDb>["db"],
  channelIds: string[],
  operatorTokenIds: string[],
): Promise<void> {
  await db.delete(schema.deliveries).where(inArray(schema.deliveries.channelId, channelIds));
  await db.delete(schema.broadcasts).where(inArray(schema.broadcasts.channelId, channelIds));
  await db.delete(schema.endpoints).where(inArray(schema.endpoints.channelId, channelIds));
  await db.delete(schema.channelTokens).where(inArray(schema.channelTokens.channelId, channelIds));
  await db.delete(schema.channels).where(inArray(schema.channels.id, channelIds));
  await db.delete(schema.operatorTokens).where(inArray(schema.operatorTokens.id, operatorTokenIds));
}

function report(
  totals: Totals,
  channelPlans: { fixture: ChannelFixture; id: string }[],
  channelTokens: { channel: string; token: string }[],
  operatorTokens: { label: string; token: string }[],
): void {
  console.log("\nseeded:");
  for (const { fixture, id } of channelPlans) {
    const flags = [
      fixture.enabled === false ? "disabled" : null,
      fixture.deletedMsAgo !== undefined ? "soft-deleted" : null,
      fixture.allowUnauthenticatedIngest ? "open ingest" : null,
    ].filter((flag): flag is string => flag !== null);
    console.log(
      `  ${fixture.slug.padEnd(38)} ${String(fixture.endpoints.length).padStart(2)} endpoints  ` +
        `${String(fixture.broadcasts).padStart(3)} broadcasts  ${id}` +
        (flags.length > 0 ? `  [${flags.join(", ")}]` : ""),
    );
  }
  console.log(
    `\ntotals: ${totals.channels} channels, ${totals.endpoints} endpoints, ` +
      `${totals.broadcasts} broadcasts, ${totals.deliveries} deliveries, ${totals.attempts} attempts`,
  );

  console.log("\ningest tokens (plaintext shown once — only the hash is stored):");
  for (const { channel, token } of channelTokens) {
    console.log(`  ${channel.padEnd(38)} ${token}`);
  }
  console.log("\noperator tokens:");
  for (const { label, token } of operatorTokens) {
    console.log(`  ${label.padEnd(38)} ${token}`);
  }
  console.log(
    "\ntry it:\n" +
      "  curl -X POST localhost:8080/ingest/stripe-prod -H 'authorization: Bearer <token above>' \\\n" +
      "    -H 'content-type: application/json' -d '{\"type\":\"invoice.paid\"}'\n",
  );
}

main().catch((error: unknown) => {
  console.error(`seed failed: ${String(error)}`);
  process.exit(1);
});
