CREATE TABLE "operator_token" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "operator_token_token_hash_unique" UNIQUE("token_hash")
);
