ALTER TABLE "eval_results" ADD COLUMN "stage_latency" jsonb;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "stage_latency" jsonb;