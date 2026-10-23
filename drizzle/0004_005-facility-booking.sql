CREATE TYPE "public"."booking_slot_state" AS ENUM('CONFIRMED', 'RESIDENT_CANCELLED', 'ADMIN_CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."facility_status" AS ENUM('ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."quota_adjustment_type" AS ENUM('REFUND_CREDIT');--> statement-breakpoint
CREATE TYPE "public"."quota_kind" AS ENUM('DAILY', 'WEEKLY', 'MONTHLY');--> statement-breakpoint
CREATE TABLE "booking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_slot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"state" "booking_slot_state" NOT NULL,
	"canceled_by" text,
	"refund_quota" boolean DEFAULT false NOT NULL,
	CONSTRAINT "booking_slot_interval_ck" CHECK ("ends_at" > "starts_at")
);
--> statement-breakpoint
CREATE TABLE "facility" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "facility_status" NOT NULL,
	"capacity" integer NOT NULL,
	CONSTRAINT "facility_project_code_uq" UNIQUE("project_id","code"),
	CONSTRAINT "facility_capacity_positive_ck" CHECK ("capacity" > 0)
);
--> statement-breakpoint
CREATE TABLE "facility_closure" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"author" text,
	CONSTRAINT "facility_closure_interval_ck" CHECK ("ends_at" > "starts_at")
);
--> statement-breakpoint
CREATE TABLE "facility_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"is_pending" boolean NOT NULL,
	"schedule_json" jsonb NOT NULL,
	"slot_minutes" integer NOT NULL,
	"quota_kind" "quota_kind" NOT NULL,
	"quota_limit" integer NOT NULL,
	"advance_days" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "facility_config_version_uq" UNIQUE("facility_id","version"),
	CONSTRAINT "facility_config_slot_positive_ck" CHECK ("slot_minutes" > 0),
	CONSTRAINT "facility_config_quota_limit_ck" CHECK ("quota_limit" >= 0),
	CONSTRAINT "facility_config_advance_days_ck" CHECK ("advance_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "quota_adjustment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_slot_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"adjustment_type" "quota_adjustment_type" NOT NULL,
	"signed_slots" integer NOT NULL,
	"reason" text NOT NULL,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quota_adjustment_slot_type_uq" UNIQUE("booking_slot_id","adjustment_type"),
	CONSTRAINT "quota_adjustment_signed_positive_ck" CHECK ("signed_slots" > 0)
);
--> statement-breakpoint
CREATE TABLE "quota_period_lock" (
	"room_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quota_period_lock_room_id_facility_id_period_key_pk" PRIMARY KEY("room_id","facility_id","period_key")
);
--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_facility_id_facility_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facility"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_slot" ADD CONSTRAINT "booking_slot_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_slot" ADD CONSTRAINT "booking_slot_facility_id_facility_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facility"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_slot" ADD CONSTRAINT "booking_slot_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_slot" ADD CONSTRAINT "booking_slot_canceled_by_user_id_fk" FOREIGN KEY ("canceled_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_closure" ADD CONSTRAINT "facility_closure_facility_id_facility_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facility"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_closure" ADD CONSTRAINT "facility_closure_author_user_id_fk" FOREIGN KEY ("author") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_config" ADD CONSTRAINT "facility_config_facility_id_facility_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facility"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_adjustment" ADD CONSTRAINT "quota_adjustment_booking_slot_id_booking_slot_id_fk" FOREIGN KEY ("booking_slot_id") REFERENCES "public"."booking_slot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_adjustment" ADD CONSTRAINT "quota_adjustment_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_adjustment" ADD CONSTRAINT "quota_adjustment_facility_id_facility_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facility"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_adjustment" ADD CONSTRAINT "quota_adjustment_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_period_lock" ADD CONSTRAINT "quota_period_lock_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_period_lock" ADD CONSTRAINT "quota_period_lock_facility_id_facility_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facility"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_room_idx" ON "booking" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "booking_facility_idx" ON "booking" USING btree ("facility_id");--> statement-breakpoint
CREATE INDEX "booking_slot_facility_idx" ON "booking_slot" USING btree ("facility_id","starts_at");--> statement-breakpoint
CREATE INDEX "booking_slot_room_idx" ON "booking_slot" USING btree ("room_id","facility_id","starts_at");--> statement-breakpoint
CREATE INDEX "booking_slot_state_idx" ON "booking_slot" USING btree ("state");--> statement-breakpoint
CREATE INDEX "booking_slot_booking_idx" ON "booking_slot" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "facility_closure_facility_idx" ON "facility_closure" USING btree ("facility_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "facility_config_pending_puq" ON "facility_config" USING btree ("facility_id") WHERE "is_pending";--> statement-breakpoint
CREATE INDEX "facility_config_facility_idx" ON "facility_config" USING btree ("facility_id","effective_at");--> statement-breakpoint
CREATE INDEX "quota_adjustment_period_idx" ON "quota_adjustment" USING btree ("room_id","facility_id","period_key");