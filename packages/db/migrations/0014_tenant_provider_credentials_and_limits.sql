CREATE TYPE "public"."provider_credential_provider" AS ENUM('anthropic', 'cartesia', 'deepgram', 'deepseek', 'google', 'openai', 'openrouter');--> statement-breakpoint
CREATE TABLE "provider_credentials" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"encrypted_key" text NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "provider_credential_provider" NOT NULL,
	"tenant_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "monthly_call_minutes_limit" integer;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "monthly_provider_spend_limit_usd" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_credentials_tenant_id_provider_index" ON "provider_credentials" USING btree ("tenant_id","provider");--> statement-breakpoint
CREATE INDEX "provider_credentials_tenant_id_index" ON "provider_credentials" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_monthly_call_minutes_nonnegative" CHECK ("tenants"."monthly_call_minutes_limit" >= 0);--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_monthly_provider_spend_nonnegative" CHECK ("tenants"."monthly_provider_spend_limit_usd" >= 0);