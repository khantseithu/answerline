ALTER TABLE "eval_results" ADD COLUMN "pronunciation" jsonb;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "pronunciation_score" double precision;