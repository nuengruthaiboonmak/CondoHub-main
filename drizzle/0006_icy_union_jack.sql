ALTER TABLE "invoice" ADD COLUMN "past_due_date_confirmed" boolean;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "past_due_date_confirmed_at" timestamp with time zone;