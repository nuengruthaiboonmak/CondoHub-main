CREATE TYPE "public"."charge_event_status" AS ENUM('OPEN', 'ISSUED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."fee_config_mode" AS ENUM('FIXED_PROJECT', 'AREA', 'PER_ROOM');--> statement-breakpoint
CREATE TYPE "public"."fee_frequency" AS ENUM('MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY', 'ONE_TIME');--> statement-breakpoint
CREATE TYPE "public"."invoice_kind" AS ENUM('PRIVATE_RENT', 'PROJECT_MANAGED_RENT', 'COMMON_FEE');--> statement-breakpoint
CREATE TYPE "public"."payment_submission_state" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."reviewer_snapshot_source" AS ENUM('ISSUE_TIME', 'TURNOVER_REVIEW');--> statement-breakpoint
CREATE TYPE "public"."turnover_decision_type" AS ENUM('ISSUE_INVOICES', 'NO_CHARGE');--> statement-breakpoint
CREATE TYPE "public"."turnover_review_state" AS ENUM('UNRESOLVED', 'RESOLVED', 'NO_CHARGE');--> statement-breakpoint
CREATE TABLE "billing_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "invoice_kind" NOT NULL,
	"room_id" uuid,
	"config_mode" "fee_config_mode" NOT NULL,
	"rate" numeric,
	"frequency" "fee_frequency" NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"enabled" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "common_fee_charge_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_rule_id" uuid,
	"event_effective_date" date NOT NULL,
	"project_timezone" text,
	"configured_amount" bigint,
	"charge_context" jsonb,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" charge_event_status NOT NULL
);
--> statement-breakpoint
CREATE TABLE "common_fee_invoice_responsible_owner" (
	"invoice_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"ownership_interval_ref" uuid,
	"assigned_at" timestamp with time zone NOT NULL,
	CONSTRAINT "common_fee_invoice_responsible_owner_invoice_id_user_id_pk" PRIMARY KEY("invoice_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "invoice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"tenancy_id" uuid,
	"kind" "invoice_kind" NOT NULL,
	"source_rule_id" uuid,
	"source_turnover_review_id" uuid,
	"reviewer_snapshot_source" "reviewer_snapshot_source",
	"one_time_charge_event_id" uuid,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"service_start" timestamp with time zone NOT NULL,
	"service_end_exclusive" timestamp with time zone NOT NULL,
	"total" bigint NOT NULL,
	"due_date" date NOT NULL,
	"snapshot_boundary_at" timestamp with time zone NOT NULL,
	"snapshot_timezone" text NOT NULL,
	"issuer_id" text,
	"issued_at" timestamp with time zone,
	"payment_instruction_snapshot" jsonb,
	"ownership_interval_ref" uuid,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_total_nonnegative_ck" CHECK ("total" >= 0),
	CONSTRAINT "invoice_rent_shape_ck" CHECK (("kind" NOT IN ('PRIVATE_RENT', 'PROJECT_MANAGED_RENT')) OR ("tenancy_id" IS NOT NULL AND "one_time_charge_event_id" IS NULL)),
	CONSTRAINT "invoice_common_recurring_shape_ck" CHECK (("kind" != 'COMMON_FEE') OR ("one_time_charge_event_id" IS NOT NULL) OR ("source_rule_id" IS NOT NULL AND "tenancy_id" IS NULL)),
	CONSTRAINT "invoice_onetime_shape_ck" CHECK (("one_time_charge_event_id" IS NULL) OR ("kind" = 'COMMON_FEE' AND "tenancy_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "invoice_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"old_total" bigint NOT NULL,
	"new_total" bigint NOT NULL,
	"reason" text,
	"actor_id" text,
	"changed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_instruction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payee_type" text NOT NULL,
	"payee_id" uuid NOT NULL,
	"bank_name" text NOT NULL,
	"account_name" text NOT NULL,
	"account_number" text NOT NULL,
	"qr_image_id" uuid,
	"effective_from" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_submission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"submitted_by" text NOT NULL,
	"image_id" uuid NOT NULL,
	"state" "payment_submission_state" NOT NULL,
	"approved_amount" bigint,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"reject_reason" text,
	CONSTRAINT "payment_submission_approved_positive_ck" CHECK ("approved_amount" IS NULL OR "approved_amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "private_rent_invoice_reviewer" (
	"invoice_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"ownership_interval_ref" uuid,
	"granted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "private_rent_invoice_reviewer_invoice_id_user_id_pk" PRIMARY KEY("invoice_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "turnover_billing_review" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"calendar_month" date NOT NULL,
	"cycle_start" timestamp with time zone NOT NULL,
	"cycle_timezone" text NOT NULL,
	"management_mode_at_creation" text NOT NULL,
	"state" "turnover_review_state" NOT NULL,
	"candidate_tenancy_ids" uuid[] NOT NULL,
	"candidate_context" jsonb,
	"version" integer NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_type" "turnover_decision_type",
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "turnover_review_room_month_uq" UNIQUE("room_id","calendar_month"),
	CONSTRAINT "turnover_review_month_day_ck" CHECK (EXTRACT(DAY FROM "calendar_month") = 1)
);
--> statement-breakpoint
CREATE TABLE "turnover_review_responsible_owner" (
	"review_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"ownership_interval_ref" uuid,
	"assigned_at" timestamp with time zone NOT NULL,
	CONSTRAINT "turnover_review_responsible_owner_review_id_user_id_pk" PRIMARY KEY("review_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "billing_rule" ADD CONSTRAINT "billing_rule_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "common_fee_charge_event" ADD CONSTRAINT "common_fee_charge_event_source_rule_id_billing_rule_id_fk" FOREIGN KEY ("source_rule_id") REFERENCES "public"."billing_rule"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "common_fee_charge_event" ADD CONSTRAINT "common_fee_charge_event_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "common_fee_invoice_responsible_owner" ADD CONSTRAINT "common_fee_invoice_responsible_owner_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "common_fee_invoice_responsible_owner" ADD CONSTRAINT "common_fee_invoice_responsible_owner_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_tenancy_id_rental_period_id_fk" FOREIGN KEY ("tenancy_id") REFERENCES "public"."rental_period"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_source_rule_id_billing_rule_id_fk" FOREIGN KEY ("source_rule_id") REFERENCES "public"."billing_rule"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_source_turnover_review_id_turnover_billing_review_id_fk" FOREIGN KEY ("source_turnover_review_id") REFERENCES "public"."turnover_billing_review"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_one_time_charge_event_id_common_fee_charge_event_id_fk" FOREIGN KEY ("one_time_charge_event_id") REFERENCES "public"."common_fee_charge_event"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_issuer_id_user_id_fk" FOREIGN KEY ("issuer_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_revision" ADD CONSTRAINT "invoice_revision_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_revision" ADD CONSTRAINT "invoice_revision_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_instruction" ADD CONSTRAINT "payment_instruction_qr_image_id_image_attachment_id_fk" FOREIGN KEY ("qr_image_id") REFERENCES "public"."image_attachment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_submission" ADD CONSTRAINT "payment_submission_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_submission" ADD CONSTRAINT "payment_submission_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_submission" ADD CONSTRAINT "payment_submission_image_id_image_attachment_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."image_attachment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_submission" ADD CONSTRAINT "payment_submission_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_rent_invoice_reviewer" ADD CONSTRAINT "private_rent_invoice_reviewer_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_rent_invoice_reviewer" ADD CONSTRAINT "private_rent_invoice_reviewer_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnover_billing_review" ADD CONSTRAINT "turnover_billing_review_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnover_billing_review" ADD CONSTRAINT "turnover_billing_review_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnover_review_responsible_owner" ADD CONSTRAINT "turnover_review_responsible_owner_review_id_turnover_billing_review_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."turnover_billing_review"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnover_review_responsible_owner" ADD CONSTRAINT "turnover_review_responsible_owner_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_rule_kind_idx" ON "billing_rule" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "billing_rule_room_idx" ON "billing_rule" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "charge_event_effective_idx" ON "common_fee_charge_event" USING btree ("event_effective_date");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_rent_natural_puq" ON "invoice" USING btree ("room_id","kind","period_start","tenancy_id") WHERE "kind" IN ('PRIVATE_RENT', 'PROJECT_MANAGED_RENT');--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_common_recurring_puq" ON "invoice" USING btree ("source_rule_id","room_id","period_start") WHERE "kind" = 'COMMON_FEE' AND "one_time_charge_event_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_common_onetime_puq" ON "invoice" USING btree ("one_time_charge_event_id","room_id") WHERE "one_time_charge_event_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "invoice_due_date_idx" ON "invoice" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "invoice_room_kind_period_idx" ON "invoice" USING btree ("room_id","kind","period_start");--> statement-breakpoint
CREATE INDEX "invoice_service_range_idx" ON "invoice" USING btree ("service_start","service_end_exclusive");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_submission_pending_puq" ON "payment_submission" USING btree ("invoice_id") WHERE "state" = 'PENDING';--> statement-breakpoint
CREATE INDEX "turnover_review_room_state_idx" ON "turnover_billing_review" USING btree ("room_id","state");