# openseas

A browser-native, touch-first space pirate puzzle MMO in the spirit of Puzzle Pirates. Crews fly a
ship together through one star system, each running a duty puzzle that drives the shared ship
through turn-based space battles, then board and fight for plunder.

`openseas` is a working codename.

- [Design document](docs/DESIGN.md): scope, puzzle designs, world model, milestones.
- [Glossary](docs/GLOSSARY.md): the game's words, and the nautical words they replaced.
- [Architecture decision records](docs/adr/README.md): why the stack is what it is.
- [`CLAUDE.md`](CLAUDE.md): rules for every coding session.

## Status

Milestone 2 done: all five duty puzzles (Cooling, Engines, Plating, Gunnery, Navigation) on
practice pages with guest accounts and ratings. Each still needs its tester session before its
numbers are trusted.

Milestone 3 built (ADR 0018, ADR 0020): the game is one graphical experience. A pirate signs in
and is in the world until they sign out: an isometric three.js star system with three outposts,
ships at their docks and under way. Take a station on deck and its puzzle opens over the world
while the ship flies. The captain picks a destination on the chart. Outpost and ship chat,
presence, the shipyard and a ship's log are in.

Milestone 4 built (ADR 0021): a raider's hail can be engaged, and the captain flies the space
battle board while the crew's stations feed it. A win pays the raider's plunder.

Milestone 5 built (ADR 0022, ADR 0032): a grapple that lands opens the boarding melee, every pirate
aboard on their own Swordfight board. The outposts and the deck are walkable. On an outpost a
pirate walks a small town (the dock with its berths and boarding tubes, the shipyard, the notice
board, a plaza and the cantina) among everyone else there. They walk down the dock and through
the boarding tube, then across the deck to the heat sinks, and its board opens.

Milestone 6 built (ADR 0025, ADR 0026): crews with flags, ranks and crew chat, crew-only ships, the
board of crews and pirates' cards, and a guest who links Discord or Google keeps everything.

Milestone 7 built (ADR 0034): the game moved from the sea to space with its mechanics unchanged.
Every word, every identifier and the whole three.js world are space: cratered rocks in the void
with a settlement bolted to each, a skiff that is a closed hull from outside and cut away to her
one room aboard (ADR 0035), pirates in jackets and headgear, and maintenance bots making up a
short crew. The puzzle boards still show their sea art under the new names until the sprite pass.

Every milestone from M2 on still needs its tester session and written retro.

The practice pages now live in the **puzzle harness** at [test.openseas.online](https://test.openseas.online)
(ADR 0019): the same boards, engines and server as the game, one puzzle at a time, with a bench
for lab rounds (chosen seed, config overrides, a clock that pauses and steps), an inspector, a
replay check and log review. That is where testers practice and thresholds are calibrated. The
game is at openseas.online.

## Layout

| Package | What |
|---|---|
| `packages/engine` | Pure, deterministic puzzle engines and rating math. Zero runtime deps. |
| `packages/protocol` | Zod schemas for every client-server message. |
| `packages/content` | World content and the message table as JSON, validated at startup. |
| `packages/server` | Node 22, `ws`, Drizzle, Better Auth. The only authority. |
| `packages/boards` | What both front ends render with: the PixiJS boards and their art and sound, the round runner, the tick clock, the server connection (ADR 0019). Renders; never authoritative. |
| `packages/client` | The game, one graphical experience: the three.js world with the boards over it (ADR 0020). Vite, React. Renders; never authoritative. |
| `packages/harness` | The puzzle test harness: one page per engine around the shared boards, plus the bench (lab rounds, scenarios as links, inspector, replay review). A developer and tester tool, never linked from the game. |

## Run it

Needs Node 22, pnpm 10, and Docker (for Postgres).

```sh
pnpm install
cp .env.example .env            # defaults work for local dev
pnpm dev                        # starts Postgres, the server on :8080, the game on :5173, the harness on :5174
pnpm dev:harness                # or just the server and the harness
```

Open http://localhost:5174 for the harness (http://localhost:5173 is the game). You get a guest
pirate and a starter skiff at once; set `ALPHA_INVITE_CODE` in `.env` to require an invite. A
harness page's query string is its scenario, for example
`http://localhost:5174/gunnery?seed=keg-3&seconds=60&c.spawnEveryTicks=20&start=lab`.

## Check it

```sh
pnpm typecheck                  # every package
pnpm test                       # engine property tests, protocol, content, server unit tests, the world's layout
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/openseas pnpm test   # plus server integration
pnpm --filter @openseas/engine lint                                                # engine purity guard
pnpm --filter @openseas/harness exec playwright install chromium && pnpm test:smoke # game and harness smoke
```

Schema changes: edit `packages/server/src/db/schema.ts`, then `pnpm db:generate` and commit the
migration. Migrations run automatically when the server starts.

## Deploy

Merging to `main` deploys. Once CI is green, the **Deploy** workflow ships the server to Railway,
waits for it to be healthy, then ships the game and the harness to their two Vercel projects.
Every pull request that touches code gets its own server, database, game preview and harness
preview, linked from a comment on the PR. One-time setup, secrets, and rollback are in
[docs/DEPLOY.md](docs/DEPLOY.md).
