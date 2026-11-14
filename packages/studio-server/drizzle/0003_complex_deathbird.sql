CREATE TABLE "studio"."chat_item" (
	"id" serial PRIMARY KEY NOT NULL,
	"draft_id" text NOT NULL,
	"turn" integer NOT NULL,
	"kind" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio"."meter" (
	"id" integer PRIMARY KEY NOT NULL,
	"spent_usd" double precision DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "studio"."draft" ADD COLUMN "chat_session" text;--> statement-breakpoint
ALTER TABLE "studio"."draft" ADD COLUMN "chat_turns" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "studio"."draft" ADD COLUMN "allowed_paths" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "studio"."draft" ADD COLUMN "spent_usd" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "studio"."chat_item" ADD CONSTRAINT "chat_item_draft_id_draft_id_fk" FOREIGN KEY ("draft_id") REFERENCES "studio"."draft"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_item_draft" ON "studio"."chat_item" USING btree ("draft_id","id");