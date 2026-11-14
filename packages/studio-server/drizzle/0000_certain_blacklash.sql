CREATE SCHEMA IF NOT EXISTS "studio";
--> statement-breakpoint
CREATE TABLE "studio"."tester_link" (
	"id" text PRIMARY KEY NOT NULL,
	"puzzle" text NOT NULL,
	"name" text NOT NULL,
	"author" text NOT NULL,
	"draft" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone
);
