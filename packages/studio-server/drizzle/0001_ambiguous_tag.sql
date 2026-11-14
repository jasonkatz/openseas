CREATE TABLE "studio"."draft" (
	"id" text PRIMARY KEY NOT NULL,
	"puzzle" text NOT NULL,
	"owner" text NOT NULL,
	"numbers" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "draft_owner_puzzle" ON "studio"."draft" USING btree ("owner","puzzle");