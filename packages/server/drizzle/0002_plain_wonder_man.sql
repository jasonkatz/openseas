CREATE TABLE "crew" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"flag" jsonb NOT NULL,
	"founder_id" text,
	"founded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voyages" integer DEFAULT 0 NOT NULL,
	"victories" integer DEFAULT 0 NOT NULL,
	"booty" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crew_invite" (
	"crew_id" text NOT NULL,
	"pirate_id" text NOT NULL,
	"by_name" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crew_invite_crew_id_pirate_id_pk" PRIMARY KEY("crew_id","pirate_id")
);
--> statement-breakpoint
CREATE TABLE "crew_member" (
	"pirate_id" text PRIMARY KEY NOT NULL,
	"crew_id" text NOT NULL,
	"rank" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crew" ADD CONSTRAINT "crew_founder_id_pirate_id_fk" FOREIGN KEY ("founder_id") REFERENCES "public"."pirate"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crew_invite" ADD CONSTRAINT "crew_invite_crew_id_crew_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."crew"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crew_invite" ADD CONSTRAINT "crew_invite_pirate_id_pirate_id_fk" FOREIGN KEY ("pirate_id") REFERENCES "public"."pirate"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crew_member" ADD CONSTRAINT "crew_member_pirate_id_pirate_id_fk" FOREIGN KEY ("pirate_id") REFERENCES "public"."pirate"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crew_member" ADD CONSTRAINT "crew_member_crew_id_crew_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."crew"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crew_name_key_uidx" ON "crew" USING btree ("name_key");--> statement-breakpoint
CREATE INDEX "crew_invite_pirate_id_idx" ON "crew_invite" USING btree ("pirate_id");--> statement-breakpoint
CREATE INDEX "crew_member_crew_id_idx" ON "crew_member" USING btree ("crew_id");