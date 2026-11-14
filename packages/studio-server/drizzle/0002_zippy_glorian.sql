ALTER TABLE "studio"."draft" ADD COLUMN "branch" text;--> statement-breakpoint
ALTER TABLE "studio"."draft" ADD COLUMN "pull_number" integer;--> statement-breakpoint
ALTER TABLE "studio"."draft" ADD COLUMN "pull_url" text;--> statement-breakpoint
ALTER TABLE "studio"."draft" ADD COLUMN "save_state" text DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "studio"."draft" ADD COLUMN "save_error" text;--> statement-breakpoint
ALTER TABLE "studio"."draft" ADD COLUMN "saved_numbers" jsonb;--> statement-breakpoint
ALTER TABLE "studio"."draft" ADD COLUMN "saved_revision" integer;