CREATE TABLE "pirate_title" (
	"pirate_id" text NOT NULL,
	"title_id" text NOT NULL,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pirate_title_pirate_id_title_id_pk" PRIMARY KEY("pirate_id","title_id")
);
--> statement-breakpoint
ALTER TABLE "pirate" ADD COLUMN "look" jsonb;--> statement-breakpoint
ALTER TABLE "pirate" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "pirate_title" ADD CONSTRAINT "pirate_title_pirate_id_pirate_id_fk" FOREIGN KEY ("pirate_id") REFERENCES "public"."pirate"("id") ON DELETE cascade ON UPDATE no action;