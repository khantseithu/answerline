ALTER TABLE "agents" ADD CONSTRAINT "agents_tenantId_id_unique" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_tenantId_agentId_id_unique" UNIQUE("tenant_id","agent_id","id");
--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_tenantId_id_unique" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "calls" DROP CONSTRAINT "calls_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "eval_runs" DROP CONSTRAINT "eval_runs_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "knowledge_chunks" DROP CONSTRAINT "knowledge_chunks_source_id_knowledge_sources_id_fk";
--> statement-breakpoint
ALTER TABLE "knowledge_sources" DROP CONSTRAINT "knowledge_sources_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "leads" DROP CONSTRAINT "leads_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "leads" DROP CONSTRAINT "leads_call_id_calls_id_fk";
--> statement-breakpoint
ALTER TABLE "voicemails" DROP CONSTRAINT "voicemails_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "voicemails" DROP CONSTRAINT "voicemails_call_id_calls_id_fk";
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tenant_id_agent_id_agents_tenant_id_id_fk" FOREIGN KEY ("tenant_id","agent_id") REFERENCES "public"."agents"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tenant_id_agent_id_call_id_calls_tenant_id_agent_id_id_fk" FOREIGN KEY ("tenant_id","agent_id","call_id") REFERENCES "public"."calls"("tenant_id","agent_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_tenant_id_agent_id_agents_tenant_id_id_fk" FOREIGN KEY ("tenant_id","agent_id") REFERENCES "public"."agents"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_tenant_id_agent_id_agents_tenant_id_id_fk" FOREIGN KEY ("tenant_id","agent_id") REFERENCES "public"."agents"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_tenant_id_source_id_knowledge_sources_tenant_id_id_fk" FOREIGN KEY ("tenant_id","source_id") REFERENCES "public"."knowledge_sources"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_tenant_id_agent_id_agents_tenant_id_id_fk" FOREIGN KEY ("tenant_id","agent_id") REFERENCES "public"."agents"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_agent_id_agents_tenant_id_id_fk" FOREIGN KEY ("tenant_id","agent_id") REFERENCES "public"."agents"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_agent_id_call_id_calls_tenant_id_agent_id_id_fk" FOREIGN KEY ("tenant_id","agent_id","call_id") REFERENCES "public"."calls"("tenant_id","agent_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "voicemails" ADD CONSTRAINT "voicemails_tenant_id_agent_id_agents_tenant_id_id_fk" FOREIGN KEY ("tenant_id","agent_id") REFERENCES "public"."agents"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "voicemails" ADD CONSTRAINT "voicemails_tenant_id_agent_id_call_id_calls_tenant_id_agent_id_id_fk" FOREIGN KEY ("tenant_id","agent_id","call_id") REFERENCES "public"."calls"("tenant_id","agent_id","id") ON DELETE cascade ON UPDATE no action;
