CREATE TYPE "public"."maintenance_routing_kind" AS ENUM('COMMON_AREA', 'PRIVATE_OWNER', 'PROJECT_MANAGED_PRIVATE');--> statement-breakpoint
CREATE TYPE "public"."maintenance_status" AS ENUM('PENDING', 'IN_PROGRESS', 'WAITING_FOR_INFO', 'COMPLETED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "maintenance_comment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_recipient" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"recipient_user_id" text NOT NULL,
	"ownership_interval_ref" uuid,
	"assigned_at" timestamp with time zone NOT NULL,
	"assigned_by" text,
	CONSTRAINT "maintenance_recipient_request_user_uq" UNIQUE("request_id","recipient_user_id")
);
--> statement-breakpoint
CREATE TABLE "maintenance_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" text NOT NULL,
	"room_id" uuid,
	"location_description" text NOT NULL,
	"routing_kind" "maintenance_routing_kind" NOT NULL,
	"status" "maintenance_status" NOT NULL,
	"subject" text NOT NULL,
	"description" text NOT NULL,
	"version" integer NOT NULL,
	"snapshot_boundary_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_request_routing_room_ck" CHECK (("routing_kind" = 'COMMON_AREA' AND "room_id" IS NULL) OR ("routing_kind" IN ('PRIVATE_OWNER', 'PROJECT_MANAGED_PRIVATE') AND "room_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "maintenance_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"from_state" text NOT NULL,
	"to_state" text NOT NULL,
	"actor_id" text,
	"reason" text,
	"changed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "maintenance_comment" ADD CONSTRAINT "maintenance_comment_request_id_maintenance_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."maintenance_request"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_comment" ADD CONSTRAINT "maintenance_comment_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_recipient" ADD CONSTRAINT "maintenance_recipient_request_id_maintenance_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."maintenance_request"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_recipient" ADD CONSTRAINT "maintenance_recipient_recipient_user_id_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_recipient" ADD CONSTRAINT "maintenance_recipient_assigned_by_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_request" ADD CONSTRAINT "maintenance_request_reporter_id_user_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_request" ADD CONSTRAINT "maintenance_request_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_status_history" ADD CONSTRAINT "maintenance_status_history_request_id_maintenance_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."maintenance_request"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_status_history" ADD CONSTRAINT "maintenance_status_history_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "maintenance_comment_request_created_idx" ON "maintenance_comment" USING btree ("request_id","created_at","id");--> statement-breakpoint
CREATE INDEX "maintenance_request_reporter_status_created_idx" ON "maintenance_request" USING btree ("reporter_id","status","created_at");--> statement-breakpoint
CREATE INDEX "maintenance_request_room_routing_created_idx" ON "maintenance_request" USING btree ("room_id","routing_kind","created_at");--> statement-breakpoint
CREATE INDEX "maintenance_status_history_request_idx" ON "maintenance_status_history" USING btree ("request_id");