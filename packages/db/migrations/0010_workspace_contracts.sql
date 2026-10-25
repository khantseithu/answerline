CREATE TYPE "public"."workspace_role" AS ENUM('owner', 'admin', 'viewer');--> statement-breakpoint
CREATE TABLE "workspace_invitations" (
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"email" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invited_by" uuid NOT NULL,
	"role" "workspace_role" NOT NULL,
	"tenant_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	CONSTRAINT "workspace_invitations_tokenHash_unique" UNIQUE("token_hash"),
	CONSTRAINT "workspace_invitations_token_hash" CHECK ("workspace_invitations"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "workspace_invitations_expiry" CHECK ("workspace_invitations"."expires_at" > "workspace_invitations"."created_at")
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" "workspace_role" NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "active_tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_invitations_tenant_id_index" ON "workspace_invitations" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_members_tenant_id_user_id_index" ON "workspace_members" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "workspace_members_user_id_index" ON "workspace_members" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_tenant_id_tenants_id_fk" FOREIGN KEY ("active_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "tenants" ("name", "slug")
SELECT COALESCE(NULLIF(current_setting('answerline.bootstrap_tenant', true), ''), 'default'),
       COALESCE(NULLIF(current_setting('answerline.bootstrap_tenant', true), ''), 'default')
WHERE EXISTS (SELECT 1 FROM "users")
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint
INSERT INTO "workspace_members" ("tenant_id", "user_id", "role")
SELECT "tenants"."id", "users"."id", 'owner'
FROM "users" JOIN "tenants"
  ON "tenants"."slug" = COALESCE(NULLIF(current_setting('answerline.bootstrap_tenant', true), ''), 'default')
ON CONFLICT ("tenant_id", "user_id") DO NOTHING;
--> statement-breakpoint
UPDATE "sessions"
SET "active_tenant_id" = "workspace_members"."tenant_id"
FROM "workspace_members"
WHERE "workspace_members"."user_id" = "sessions"."user_id";
