CREATE TYPE "public"."webhook_delivery_status" AS ENUM('pending', 'delivered', 'failed');--> statement-breakpoint
CREATE TYPE "public"."webhook_event_type" AS ENUM('booking.created', 'call.ended', 'call.started', 'eval.completed', 'lead.created');--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"endpoint_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"event_type" "webhook_event_type" NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone,
	"payload" jsonb NOT NULL,
	"replay_count" integer DEFAULT 0 NOT NULL,
	"response_body" text,
	"response_status" integer,
	"status" "webhook_delivery_status" DEFAULT 'pending' NOT NULL,
	"tenant_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"encrypted_secret" text NOT NULL,
	"events" "webhook_event_type"[] NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"url" text NOT NULL,
	CONSTRAINT "webhook_endpoints_tenantId_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_tenant_id_endpoint_id_webhook_endpoints_tenant_id_id_fk" FOREIGN KEY ("tenant_id","endpoint_id") REFERENCES "public"."webhook_endpoints"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_deliveries_tenant_id_created_at_index" ON "webhook_deliveries" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_endpoint_id_event_id_index" ON "webhook_deliveries" USING btree ("endpoint_id","event_id");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_tenant_id_index" ON "webhook_endpoints" USING btree ("tenant_id");