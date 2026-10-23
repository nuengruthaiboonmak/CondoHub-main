CREATE EXTENSION IF NOT EXISTS "btree_gist";--> statement-breakpoint
CREATE TYPE "public"."management_mode" AS ENUM('PROJECT_MANAGED', 'PRIVATE_OWNER_MANAGED');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('MAIN', 'SUB');--> statement-breakpoint
CREATE TYPE "public"."rental_state" AS ENUM('ACTIVE', 'ENDED');--> statement-breakpoint
CREATE TABLE "rental_period" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"state" "rental_state" NOT NULL,
	"management_mode" "management_mode" NOT NULL,
	"created_by" text,
	CONSTRAINT "rental_period_interval_ck" CHECK ("ends_at" IS NULL OR "ends_at" > "starts_at")
);
--> statement-breakpoint
CREATE TABLE "room_membership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"tenancy_id" uuid,
	"user_id" text NOT NULL,
	"member_role" "member_role" NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_membership_interval_ck" CHECK ("end_at" IS NULL OR "end_at" > "start_at")
);
--> statement-breakpoint
CREATE TABLE "room_ownership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"granted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_ownership_interval_ck" CHECK ("end_at" IS NULL OR "end_at" > "start_at")
);
--> statement-breakpoint
ALTER TABLE "rental_period" ADD CONSTRAINT "rental_period_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_period" ADD CONSTRAINT "rental_period_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_membership" ADD CONSTRAINT "room_membership_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_membership" ADD CONSTRAINT "room_membership_tenancy_id_rental_period_id_fk" FOREIGN KEY ("tenancy_id") REFERENCES "public"."rental_period"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_membership" ADD CONSTRAINT "room_membership_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_ownership" ADD CONSTRAINT "room_ownership_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_ownership" ADD CONSTRAINT "room_ownership_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_ownership" ADD CONSTRAINT "room_ownership_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rental_period_room_idx" ON "rental_period" USING btree ("room_id");--> statement-breakpoint
CREATE UNIQUE INDEX "room_membership_active_tenancy_puq" ON "room_membership" USING btree ("room_id","user_id","tenancy_id") WHERE "end_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "room_membership_active_direct_puq" ON "room_membership" USING btree ("room_id","user_id") WHERE "end_at" IS NULL AND "tenancy_id" IS NULL;--> statement-breakpoint
CREATE INDEX "room_membership_room_idx" ON "room_membership" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "room_membership_user_idx" ON "room_membership" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "room_membership_tenancy_idx" ON "room_membership" USING btree ("tenancy_id");--> statement-breakpoint
CREATE INDEX "room_ownership_room_idx" ON "room_ownership" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "room_ownership_user_idx" ON "room_ownership" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "room_ownership" ADD CONSTRAINT "room_ownership_no_overlap_ex" EXCLUDE USING gist ("room_id" WITH =, "user_id" WITH =, tstzrange("start_at", COALESCE("end_at", 'infinity'::timestamptz)) WITH &&);--> statement-breakpoint
ALTER TABLE "rental_period" ADD CONSTRAINT "rental_period_active_no_overlap_ex" EXCLUDE USING gist ("room_id" WITH =, tstzrange("starts_at", COALESCE("ends_at", 'infinity'::timestamptz)) WITH &&) WHERE ("state" = 'ACTIVE');