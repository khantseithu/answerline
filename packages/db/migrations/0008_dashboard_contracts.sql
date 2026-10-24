CREATE TABLE "agent_versions" (
	"agent_id" uuid NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "cost_breakdown" jsonb;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "model_usage" jsonb;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "recording_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "sentiment" text;--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_versions_agent_id_version_index" ON "agent_versions" USING btree ("agent_id","version");