CREATE TABLE "studio"."chat" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"puzzle" text NOT NULL,
	"draft_id" text,
	"title" text NOT NULL,
	"session" text,
	"turns" integer DEFAULT 0 NOT NULL,
	"spent_usd" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "studio"."chat_item" DROP CONSTRAINT "chat_item_draft_id_draft_id_fk";
--> statement-breakpoint
DROP INDEX "studio"."chat_item_draft";--> statement-breakpoint
ALTER TABLE "studio"."chat_item" ALTER COLUMN "draft_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "studio"."chat_item" ADD COLUMN "chat_id" text;--> statement-breakpoint
-- A draft's one chat from before chats were many (ADR 0059) becomes its first, under the draft's own id, with its session, its turns and what it spent.
INSERT INTO "studio"."chat" ("id", "owner", "puzzle", "draft_id", "title", "session", "turns", "spent_usd", "created_at", "updated_at")
SELECT d."id", d."owner", d."puzzle", d."id",
	coalesce((SELECT left(regexp_replace(i."data"->>'text', '\s+', ' ', 'g'), 80) FROM "studio"."chat_item" i WHERE i."draft_id" = d."id" AND i."kind" = 'user' ORDER BY i."id" LIMIT 1), 'Chat'),
	d."chat_session", d."chat_turns", d."spent_usd",
	(SELECT min(i."created_at") FROM "studio"."chat_item" i WHERE i."draft_id" = d."id"),
	(SELECT max(i."created_at") FROM "studio"."chat_item" i WHERE i."draft_id" = d."id")
FROM "studio"."draft" d
WHERE EXISTS (SELECT 1 FROM "studio"."chat_item" i WHERE i."draft_id" = d."id");--> statement-breakpoint
UPDATE "studio"."chat_item" SET "chat_id" = "draft_id";--> statement-breakpoint
ALTER TABLE "studio"."chat_item" ALTER COLUMN "chat_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "studio"."chat" ADD CONSTRAINT "chat_draft_id_draft_id_fk" FOREIGN KEY ("draft_id") REFERENCES "studio"."draft"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_owner_puzzle" ON "studio"."chat" USING btree ("owner","puzzle","updated_at");--> statement-breakpoint
CREATE INDEX "chat_draft" ON "studio"."chat" USING btree ("draft_id");--> statement-breakpoint
ALTER TABLE "studio"."chat_item" ADD CONSTRAINT "chat_item_chat_id_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "studio"."chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio"."chat_item" ADD CONSTRAINT "chat_item_draft_id_draft_id_fk" FOREIGN KEY ("draft_id") REFERENCES "studio"."draft"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_item_chat" ON "studio"."chat_item" USING btree ("chat_id","id");--> statement-breakpoint
CREATE INDEX "chat_item_draft" ON "studio"."chat_item" USING btree ("draft_id","turn");--> statement-breakpoint
ALTER TABLE "studio"."draft" DROP COLUMN "chat_session";
