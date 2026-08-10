CREATE TYPE "public"."delivery_status" AS ENUM('pending', 'in_progress', 'succeeded', 'failed', 'dead_lettered');--> statement-breakpoint
CREATE TABLE "attempt" (
	"id" uuid PRIMARY KEY NOT NULL,
	"delivery_id" uuid NOT NULL,
	"n" integer NOT NULL,
	"status_code" integer,
	"duration_ms" integer,
	"error" text,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcast" (
	"id" uuid PRIMARY KEY NOT NULL,
	"channel_id" uuid NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"content_type" text NOT NULL,
	"body" "bytea" NOT NULL,
	"headers" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_token" (
	"id" uuid PRIMARY KEY NOT NULL,
	"channel_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "channel_token_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "channel" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "channel_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "delivery" (
	"id" uuid PRIMARY KEY NOT NULL,
	"broadcast_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"status" "delivery_status" NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_status_code" integer,
	"last_duration_ms" integer,
	"last_error" text,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "endpoint" (
	"id" uuid PRIMARY KEY NOT NULL,
	"channel_id" uuid NOT NULL,
	"name" text,
	"url" text NOT NULL,
	"timeout_ms" integer,
	"headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"auto_disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attempt" ADD CONSTRAINT "attempt_delivery_id_delivery_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."delivery"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast" ADD CONSTRAINT "broadcast_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_token" ADD CONSTRAINT "channel_token_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_broadcast_id_broadcast_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcast"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_endpoint_id_endpoint_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."endpoint"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endpoint" ADD CONSTRAINT "endpoint_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attempt_delivery_id_n_key" ON "attempt" USING btree ("delivery_id","n");--> statement-breakpoint
CREATE INDEX "broadcast_channel_received_id_idx" ON "broadcast" USING btree ("channel_id","received_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "broadcast_received_at_idx" ON "broadcast" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "channel_token_channel_id_idx" ON "channel_token" USING btree ("channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_broadcast_endpoint_key" ON "delivery" USING btree ("broadcast_id","endpoint_id");--> statement-breakpoint
CREATE INDEX "delivery_broadcast_id_idx" ON "delivery" USING btree ("broadcast_id");--> statement-breakpoint
CREATE INDEX "delivery_endpoint_updated_idx" ON "delivery" USING btree ("endpoint_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "endpoint_channel_id_url_key" ON "endpoint" USING btree ("channel_id","url");--> statement-breakpoint
CREATE INDEX "endpoint_channel_id_idx" ON "endpoint" USING btree ("channel_id");