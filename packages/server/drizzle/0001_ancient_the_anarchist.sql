CREATE TABLE "voyage" (
	"id" text PRIMARY KEY NOT NULL,
	"ship_id" text NOT NULL,
	"route_id" text NOT NULL,
	"captain_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"outcome" text,
	"turns" integer DEFAULT 0 NOT NULL,
	"encounter" jsonb
);
--> statement-breakpoint
CREATE TABLE "voyage_crew" (
	"voyage_id" text NOT NULL,
	"pirate_id" text NOT NULL,
	"boarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	CONSTRAINT "voyage_crew_voyage_id_pirate_id_pk" PRIMARY KEY("voyage_id","pirate_id")
);
--> statement-breakpoint
ALTER TABLE "pirate" ADD COLUMN "island_id" text;--> statement-breakpoint
ALTER TABLE "puzzle_round" ADD COLUMN "voyage_id" text;--> statement-breakpoint
ALTER TABLE "puzzle_round" ADD COLUMN "rated" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ship" ADD COLUMN "island_id" text;--> statement-breakpoint
ALTER TABLE "voyage" ADD CONSTRAINT "voyage_ship_id_ship_id_fk" FOREIGN KEY ("ship_id") REFERENCES "public"."ship"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voyage" ADD CONSTRAINT "voyage_captain_id_pirate_id_fk" FOREIGN KEY ("captain_id") REFERENCES "public"."pirate"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voyage_crew" ADD CONSTRAINT "voyage_crew_voyage_id_voyage_id_fk" FOREIGN KEY ("voyage_id") REFERENCES "public"."voyage"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voyage_crew" ADD CONSTRAINT "voyage_crew_pirate_id_pirate_id_fk" FOREIGN KEY ("pirate_id") REFERENCES "public"."pirate"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voyage_ship_id_idx" ON "voyage" USING btree ("ship_id");--> statement-breakpoint
CREATE INDEX "voyage_crew_pirate_id_idx" ON "voyage_crew" USING btree ("pirate_id");