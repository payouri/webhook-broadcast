-- Expand step (issue #34 / docs/adr/0011-expand-contract-migrations.md): add
-- `attempt_number` alongside the existing `n` column and backfill it from
-- `n` for every row that exists when this migration runs. Nothing reads or
-- writes this column yet, and `n` is untouched, so rows inserted after this
-- point keep `attempt_number` NULL until the dual-write deploy lands — the
-- ADR's step 3 sweep is what fills that gap. Only after that sweep reports
-- zero residual NULLs does a *separate* contract migration drop `n` and its
-- `attempt_delivery_id_n_key` index and make `attempt_number` NOT NULL.
ALTER TABLE "attempt" ADD COLUMN "attempt_number" integer;--> statement-breakpoint
UPDATE "attempt" SET "attempt_number" = "n" WHERE "attempt_number" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "attempt_delivery_id_attempt_number_key" ON "attempt" USING btree ("delivery_id","attempt_number");