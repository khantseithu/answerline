CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_agent_no_overlap" EXCLUDE USING gist ("agent_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&) WHERE ("status" = 'confirmed' AND "ends_at" IS NOT NULL);
