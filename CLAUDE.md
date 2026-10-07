# openseas

Browser-native, touch-first pirate puzzle MMO. Spiritual successor to Puzzle Pirates: faithful
mechanics, original everything else. `openseas` is a codename.

## Read first

- `docs/DESIGN.md` is the source of truth for scope and product decisions. Read it before any
  feature work. If code and the design doc disagree, fix one in the same PR.
- `docs/adr/` holds the rationale for every architecture choice. Read the index. Never edit an
  accepted ADR's decision; add a superseding one.

## Non-negotiable rules

1. **The `engine` package is pure.** Zero runtime dependencies. No I/O, timers, `Date`, `Math.random`,
   or global state. All randomness comes from an injected seeded PRNG. Same seed plus same move log
   must always produce the same state. Impurity is a correctness bug (ADR 0003).
2. **The server is the only authority.** The client simulates for feel and streams move logs; the
   server replays with the same engine and derives every score. Never trust a client-reported score.
3. **Nothing is copied from Puzzle Pirates.** No names the original coined, no art, no text, no
   audio. Generic nautical puzzle names are fine (ADR 0001).
4. **World content is files, not rows.** Islands, routes, brigand tiers, ship classes live in
   `content` as JSON validated at startup (ADR 0009). Player state lives in Postgres.
5. **Every player-facing string goes through the message table.** English only, but never
   hardcode UI text.
6. **Every piece type is distinguishable by shape and color.** Accessibility is not retrofitted.

## Stack

TypeScript, pnpm monorepo, Node 22. Packages: `engine`, `protocol` (Zod schemas), `content`,
`server` (ws, Drizzle, Better Auth), `client` (Vite, React, PixiJS v8). Postgres. Railway for
server and database, Vercel for the client. Vitest with property-based determinism tests on
engines, Playwright smoke on the client.

## Workflow

- Work on a branch, open a PR, the owner reviews and merges. CI must be green before review.
- Follow the milestone ladder in `docs/DESIGN.md` section 5.2. Do not start the next puzzle before
  the current one has shipped to its practice page.
- Property-based determinism tests are written before an engine is wired to the server.
- Record any new architecture decision as an ADR in the same PR.
- Record any deliberate divergence from the original in `docs/DESIGN.md` section 6.
