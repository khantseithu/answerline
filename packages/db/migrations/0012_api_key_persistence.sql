CREATE TYPE "public"."api_key_scope" AS ENUM('calls:read', 'agents:read', 'agents:write', 'knowledge:read', 'knowledge:write', 'evals:read', 'evals:write');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"digest" text NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"last_used_at" timestamp with time zone,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"scopes" "api_key_scope"[] NOT NULL,
	"tenant_id" uuid NOT NULL,
	CONSTRAINT "api_keys_digest_unique" UNIQUE("digest"),
	CONSTRAINT "api_keys_digest" CHECK ("api_keys"."digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "api_keys_prefix" CHECK (char_length("api_keys"."prefix") between 1 and 16),
	CONSTRAINT "api_keys_scopes" CHECK (cardinality("api_keys"."scopes") > 0 and array_position("api_keys"."scopes", null) is null)
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_tenant_id_index" ON "api_keys" USING btree ("tenant_id");