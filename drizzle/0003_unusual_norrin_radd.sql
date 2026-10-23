CREATE TYPE "public"."image_scope" AS ENUM('PAYMENT_SLIP', 'PAYMENT_QR', 'MAINTENANCE', 'ANNOUNCEMENT', 'CHAT');--> statement-breakpoint
CREATE TYPE "public"."image_state" AS ENUM('PENDING', 'UPLOADED', 'READY', 'REJECTED', 'ORPHANED');--> statement-breakpoint
CREATE TABLE "announcement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"publish_at" timestamp with time zone,
	"hidden_at" timestamp with time zone,
	"edited_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "announcement_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"announcement_id" uuid NOT NULL,
	"actor_id" text,
	"version" integer NOT NULL,
	"snapshot_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcement_revision_version_uq" UNIQUE("announcement_id","version")
);
--> statement-breakpoint
CREATE TABLE "image_attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"uploaded_by" text NOT NULL,
	"object_key" text NOT NULL,
	"scope" "image_scope" NOT NULL,
	"mime" text NOT NULL,
	"mime_verified" boolean DEFAULT false NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"sha256" text,
	"width" integer,
	"height" integer,
	"state" "image_state" DEFAULT 'PENDING' NOT NULL,
	"owner_entity_type" text,
	"owner_entity_id" uuid,
	"attached_at" timestamp with time zone,
	"reject_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "image_attachment_object_key_uq" UNIQUE("object_key"),
	CONSTRAINT "image_attachment_owner_pair_ck" CHECK (("owner_entity_type" IS NULL AND "owner_entity_id" IS NULL) OR ("owner_entity_type" IS NOT NULL AND "owner_entity_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_revision" ADD CONSTRAINT "announcement_revision_announcement_id_announcement_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcement"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_revision" ADD CONSTRAINT "announcement_revision_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_attachment" ADD CONSTRAINT "image_attachment_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcement_publish_idx" ON "announcement" USING btree ("publish_at","id");--> statement-breakpoint
CREATE INDEX "announcement_revision_announcement_idx" ON "announcement_revision" USING btree ("announcement_id");--> statement-breakpoint
CREATE INDEX "image_attachment_sweeper_idx" ON "image_attachment" USING btree ("scope","state","created_at");--> statement-breakpoint
CREATE INDEX "image_attachment_owner_idx" ON "image_attachment" USING btree ("owner_entity_type","owner_entity_id");