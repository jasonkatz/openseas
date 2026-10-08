# openseas

A browser-native, touch-first pirate puzzle MMO in the spirit of Puzzle Pirates. Crews sail a ship
together, each running a duty puzzle that drives the shared ship through turn-based sea battles,
then board and fight for booty.

`openseas` is a working codename.

- [Design document](docs/DESIGN.md): scope, puzzle designs, world model, milestones.
- [Architecture decision records](docs/adr/README.md): why the stack is what it is.
- [`CLAUDE.md`](CLAUDE.md): rules for every coding session.

## Status

Milestone 1: the Bilging practice page with guest accounts and ratings. Sailing is next, after
the tester session and retro for M1.

## Layout

| Package | What |
|---|---|
| `packages/engine` | Pure, deterministic puzzle engines and rating math. Zero runtime deps. |
| `packages/protocol` | Zod schemas for every client-server message. |
| `packages/content` | World content and the message table as JSON, validated at startup. |
| `packages/server` | Node 22, `ws`, Drizzle, Better Auth. The only authority. |
| `packages/client` | Vite, React, PixiJS v8. Renders; never authoritative. |

## Run it

Needs Node 22, pnpm 10, and Docker (for Postgres).

```sh
pnpm install
cp .env.example .env            # defaults work for local dev
pnpm dev                        # starts Postgres, the server on :8080, the client on :5173
```

Open http://localhost:5173. You get a guest pirate and a starter sloop at once; set
`ALPHA_INVITE_CODE` in `.env` to require an invite.

## Check it

```sh
pnpm typecheck                  # every package
pnpm test                       # engine property tests, protocol, content, server unit tests
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/openseas pnpm test   # plus server integration
pnpm --filter @openseas/engine lint                                                # engine purity guard
pnpm --filter @openseas/client exec playwright install chromium && pnpm test:smoke # client smoke
```

Schema changes: edit `packages/server/src/db/schema.ts`, then `pnpm db:generate` and commit the
migration. Migrations run automatically when the server starts.

## Deploy

Merging to `main` deploys. Railway builds the server, Vercel builds the client, and the
**Deploy verify** workflow confirms both serve the merged commit. One-time setup, variables, and
rollback are in [docs/DEPLOY.md](docs/DEPLOY.md).
