CREATE TYPE "public"."chat_message_type" AS ENUM('TEXT', 'IMAGE');--> statement-breakpoint
CREATE TABLE "chat_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_user_id" text NOT NULL,
	"client_message_id" uuid NOT NULL,
	"type" "chat_message_type" NOT NULL,
	"text" text,
	"image_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "chat_message_sender_key_uq" UNIQUE("conversation_id","sender_user_id","client_message_id"),
	CONSTRAINT "chat_message_text_or_image_ck" CHECK ("text" IS NOT NULL OR "image_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "room_conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_conversation_room_uq" UNIQUE("room_id")
);
--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_conversation_id_room_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."room_conversation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_sender_user_id_user_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_image_id_image_attachment_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."image_attachment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_conversation" ADD CONSTRAINT "room_conversation_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_message_conversation_created_idx" ON "chat_message" USING btree ("conversation_id","created_at","id");