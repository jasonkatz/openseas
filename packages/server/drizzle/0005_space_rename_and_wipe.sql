-- M7, the move to space (ADR 0034): the database is wiped, sign-ins included, so everyone
-- returns as a new guest. No data is mapped from old ids to new ones. With nothing left to
-- keep, the columns below take their new names directly.
TRUNCATE TABLE "user", "session", "account", "verification", "pirate", "pirate_title", "ship", "ledger_entry", "rating", "puzzle_round", "voyage", "voyage_crew", "crew", "crew_member", "crew_invite", "event" RESTART IDENTITY CASCADE;--> statement-breakpoint
ALTER TABLE "crew" RENAME COLUMN "booty" TO "plunder";--> statement-breakpoint
ALTER TABLE "pirate" RENAME COLUMN "island_id" TO "outpost_id";--> statement-breakpoint
ALTER TABLE "ship" RENAME COLUMN "island_id" TO "outpost_id";--> statement-breakpoint
ALTER TABLE "voyage" RENAME COLUMN "route_id" TO "lane_id";
