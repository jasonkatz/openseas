CREATE TABLE "studio"."take" (
	"hash" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"puzzle" text NOT NULL,
	"name" text NOT NULL,
	"bytes" integer NOT NULL,
	"prompt" text,
	"draft_id" text,
	"take" integer,
	"author" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "take_puzzle" ON "studio"."take" USING btree ("puzzle","kind","name");