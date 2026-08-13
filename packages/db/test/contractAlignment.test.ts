import {
  type Attempt,
  attemptSchema,
  type Channel,
  channelSchema,
  type BroadcastDetail,
  broadcastDetailSchema,
  type DeliveryDetail,
  deliveryDetailSchema,
  deliveryStatusSchema as contractDeliveryStatusSchema,
  type Endpoint,
  endpointSchema,
} from "@webhook-broadcast/contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  attemptRowSchema,
  type AttemptZodRow,
  broadcastRowSchema,
  type BroadcastZodRow,
  channelRowSchema,
  type ChannelZodRow,
  deliveryRowSchema,
  deliveryStatusSchema as dbDeliveryStatusSchema,
  type DeliveryZodRow,
  endpointRowSchema,
  type EndpointZodRow,
} from "../src/zod.js";

/**
 * Issue #32 (Wire drizzle-zod interop between packages/db and
 * packages/contract): `packages/contract`'s Channel/Endpoint/Broadcast/
 * Delivery/Attempt schemas are still hand-authored (contract must not
 * depend on `db` at runtime — it's bundled into `apps/web`, and `db` pulls
 * in Node-only `pg`/`drizzle-orm`). This file is the drift guard for that
 * split: it round-trips a sample value for every DB column that also
 * appears in the published contract through *both* the `drizzle-zod`
 * schema generated from `packages/db/src/schema.ts` and the corresponding
 * `packages/contract` schema.
 *
 * Two independent failure modes, both deliberate:
 * - Runtime: renaming/dropping a shared field, or changing its Drizzle type
 *   so the contract schema rejects a value the DB schema accepts, fails the
 *   `safeParse` assertions below.
 * - Compile-time: the `Expect<Equal<...>>` blocks fail `tsc` the moment a
 *   Drizzle column's inferred TS type stops matching the mirrored contract
 *   field, before anyone even runs the tests.
 *
 * Either way, a Drizzle column that's part of the published contract can't
 * drift silently — this test (or `tsc`) breaks and points at the mismatch.
 *
 * The compared field set is **derived**, never listed: it's the intersection
 * of the two schemas' keys minus an explicit per-entity `skip`. That makes the
 * guard fail-closed. A column added to both the Drizzle table and the contract
 * is compared automatically, so it cannot slip past by simply not appearing on
 * a hand-maintained list — which is the one hole a listed field set leaves, and
 * the exact silent drift this file exists to prevent. Each `skip` entry is a
 * deliberate serialization boundary and carries its reason; a stale entry
 * (naming a field that is no longer shared) fails too, so the exclusion lists
 * can't quietly rot into blanket suppressions.
 */

type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 0) extends <T>() => T extends Y ? 1 : 0 ? true : false;
type Expect<T extends true> = T;

/**
 * The fields actually compared for an entity: every key the DB row and the
 * contract shape share, except the deliberate serialization boundaries in
 * `Skip`. Mirrors `sharedFields` below so the type and runtime halves of the
 * guard always cover the same set.
 */
type Shared<DbRow, Contract, Skip extends string> = Exclude<
  Extract<keyof DbRow, keyof Contract>,
  Skip
>;

/** Runtime twin of `Shared`: intersection of both shapes' keys, minus `skip`. */
function sharedFields(
  dbSchema: z.ZodObject<Record<string, z.ZodType>>,
  contractSchema: z.ZodObject<Record<string, z.ZodType>>,
  skip: readonly string[],
): string[] {
  const contractKeys = new Set(Object.keys(contractSchema.shape));
  const shared = Object.keys(dbSchema.shape).filter((key) => contractKeys.has(key));

  for (const field of skip) {
    expect(
      shared,
      `skip entry "${field}" is no longer a field shared by both schemas — drop it from the ` +
        "skip list rather than leaving it to suppress a field that may come back",
    ).toContain(field);
  }

  return shared.filter((key) => !skip.includes(key));
}

/** Fields shared verbatim between the DB row and the contract's read shape. */
function expectSharedFieldsRoundtrip(
  dbSchema: z.ZodObject<Record<string, z.ZodType>>,
  dbSample: Record<string, unknown>,
  contractSchema: z.ZodObject<Record<string, z.ZodType>>,
  skip: readonly string[],
): void {
  // Throws on a Drizzle column the sample doesn't cover, so adding a column
  // forces this fixture to be updated rather than going unchecked.
  const parsedDbSample = dbSchema.parse(dbSample);
  const fields = sharedFields(dbSchema, contractSchema, skip);
  expect(
    fields.length,
    "no shared fields left to compare — the guard would be vacuous",
  ).toBeGreaterThan(0);

  for (const field of fields) {
    const contractFieldSchema = contractSchema.shape[field];
    expect(contractFieldSchema, `contract schema is missing field "${field}"`).toBeDefined();

    const value = (parsedDbSample as Record<string, unknown>)[field];
    expect(
      contractFieldSchema!.safeParse(value).success,
      `field "${field}": contract schema rejected a value that is valid for the Drizzle column — ` +
        "the Drizzle column and the published contract have drifted",
    ).toBe(true);
  }
}

/**
 * Per-entity serialization boundaries: fields both sides carry under the same
 * name but deliberately represent differently, so comparing them would fail by
 * design. Declared once and used by both halves of the guard.
 */
const channelSkip = ["deletedAt", "createdAt", "updatedAt"] as const; // Date -> ISO string
type ChannelSkip = (typeof channelSkip)[number];

const endpointSkip = ["autoDisabledAt", "createdAt", "updatedAt"] as const; // Date -> ISO string
type EndpointSkip = (typeof endpointSkip)[number];

/** `receivedAt` is Date -> ISO string; `body` is a `bytea` Buffer -> UTF-8 string. */
const broadcastSkip = ["receivedAt", "body"] as const;
type BroadcastSkip = (typeof broadcastSkip)[number];

const deliverySkip = ["updatedAt"] as const; // Date -> ISO string
type DeliverySkip = (typeof deliverySkip)[number];

const attemptSkip = ["at"] as const; // Date -> ISO string
type AttemptSkip = (typeof attemptSkip)[number];

describe("packages/db <-> packages/contract field alignment (issue #32)", () => {
  it("Channel: shared fields round-trip through both schemas", () => {
    expectSharedFieldsRoundtrip(
      channelRowSchema,
      {
        id: "c57e800c-33f8-4808-8600-6a561cd8e9ce",
        slug: "sample-channel",
        description: "a channel",
        enabled: true,
        forwardHeaders: ["x-request-id"],
        allowUnauthenticatedIngest: false,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      channelSchema,
      channelSkip,
    );
  });

  it("Endpoint: shared fields round-trip through both schemas", () => {
    expectSharedFieldsRoundtrip(
      endpointRowSchema,
      {
        id: "c57e800c-33f8-4808-8600-6a561cd8e9ce",
        channelId: "d68f911d-44a9-4919-9711-7b672de8fadf",
        name: "sample endpoint",
        url: "https://example.com/hook",
        timeoutMs: 5000,
        headers: { "x-api-key": "secret" },
        enabled: true,
        autoDisabledAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      endpointSchema,
      endpointSkip,
    );
  });

  it("Broadcast: shared fields round-trip through both schemas", () => {
    expectSharedFieldsRoundtrip(
      broadcastRowSchema,
      {
        id: "c57e800c-33f8-4808-8600-6a561cd8e9ce",
        channelId: "d68f911d-44a9-4919-9711-7b672de8fadf",
        receivedAt: new Date(),
        contentType: "application/json",
        body: Buffer.from("{}", "utf8"),
        headers: { "content-type": "application/json" },
      },
      broadcastDetailSchema,
      broadcastSkip,
    );
  });

  it("Delivery: shared fields round-trip through both schemas", () => {
    expectSharedFieldsRoundtrip(
      deliveryRowSchema,
      {
        id: "c57e800c-33f8-4808-8600-6a561cd8e9ce",
        broadcastId: "d68f911d-44a9-4919-9711-7b672de8fadf",
        endpointId: "e79fa22e-55ba-4a2a-a822-8c783ef90b10",
        channelId: "fa8ab33f-66cb-4b3b-b933-9d894f001c21",
        status: "succeeded",
        attemptCount: 1,
        lastStatusCode: 200,
        lastDurationMs: 120,
        lastError: null,
        updatedAt: new Date(),
      },
      deliveryDetailSchema,
      deliverySkip,
    );
  });

  it("delivery_status enum: identical literal values on both sides", () => {
    expect(dbDeliveryStatusSchema.options).toEqual(contractDeliveryStatusSchema.options);
  });

  it("Attempt: shared fields round-trip through both schemas", () => {
    expectSharedFieldsRoundtrip(
      attemptRowSchema,
      {
        id: "c57e800c-33f8-4808-8600-6a561cd8e9ce",
        deliveryId: "d68f911d-44a9-4919-9711-7b672de8fadf",
        n: 1,
        // Expand-phase column (issue #34 / ADR 0011): mirrors `n`, as migration
        // 0006's backfill sets it for every row that predates the dual-write
        // deploy. `n` stays authoritative until the contract phase lands.
        attemptNumber: 1,
        statusCode: 200,
        durationMs: 80,
        error: null,
        at: new Date(),
      },
      attemptSchema,
      attemptSkip,
    );
  });
});

// --- Compile-time alignment: Expect<Equal<...>> fails `tsc` the moment a
// Drizzle column's inferred type stops matching the mirrored contract field.
// The key set is derived via `Shared`, so a column added to both sides is
// covered here automatically — including one whose types disagree.

type ChannelKeys = Shared<ChannelZodRow, Channel, ChannelSkip>;
type _ChannelAligned = Expect<Equal<Pick<ChannelZodRow, ChannelKeys>, Pick<Channel, ChannelKeys>>>;

type EndpointKeys = Shared<EndpointZodRow, Endpoint, EndpointSkip>;
type _EndpointAligned = Expect<
  Equal<Pick<EndpointZodRow, EndpointKeys>, Pick<Endpoint, EndpointKeys>>
>;

type BroadcastKeys = Shared<BroadcastZodRow, BroadcastDetail, BroadcastSkip>;
type _BroadcastAligned = Expect<
  Equal<Pick<BroadcastZodRow, BroadcastKeys>, Pick<BroadcastDetail, BroadcastKeys>>
>;

type DeliveryKeys = Shared<DeliveryZodRow, DeliveryDetail, DeliverySkip>;
type _DeliveryAligned = Expect<
  Equal<Pick<DeliveryZodRow, DeliveryKeys>, Pick<DeliveryDetail, DeliveryKeys>>
>;

type AttemptKeys = Shared<AttemptZodRow, Attempt, AttemptSkip>;
type _AttemptAligned = Expect<Equal<Pick<AttemptZodRow, AttemptKeys>, Pick<Attempt, AttemptKeys>>>;
