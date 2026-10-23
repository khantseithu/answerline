DROP INDEX "tool_calls_call_id_index";--> statement-breakpoint
ALTER TABLE "tool_calls" ADD COLUMN "seq" integer NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tool_calls_call_id_seq_index" ON "tool_calls" USING btree ("call_id","seq");