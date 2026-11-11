# openseas

Browser-native, touch-first space pirate puzzle MMO. Spiritual successor to Puzzle Pirates: faithful
mechanics, original everything else. `openseas` is a codename. The game moved from the sea to space
in milestone M7 (ADR 0034): its words, its code, its three.js world and its puzzle boards (sprites,
frames, fallback pieces and sounds) are space. ADRs 0001 to 0033 keep the nautical words they were
written in.

## Read first

- `docs/DESIGN.md` is the source of truth for scope and product decisions. Read it before any
  feature work. If code and the design doc disagree, fix one in the same PR.
- `docs/adr/` holds the rationale for every architecture choice. Read the index. Never edit an
  accepted ADR's decision; add a superseding one.
- `docs/GLOSSARY.md` holds the game's words and the nautical words they replaced, with the
  identifier for each. Name new things by it, and read older ADRs through it.
- `docs/prototypes/` holds the prototype puzzles (ADR 0036): eight new puzzles on the harness, none in
  the game yet. Its README says what a prototype is made of and the rules it keeps; each puzzle has
  a design file there that changes in the same commit as its rules or numbers.
- `packages/docs/README.md` says how a puzzle guide is written and how its pictures are captured
  (ADR 0038).

## Non-negotiable rules

1. **The `engine` package is pure.** Zero runtime dependencies. No I/O, timers, `Date`, `Math.random`,
   or global state. All randomness comes from an injected seeded PRNG. Same seed plus same move log
   must always produce the same state. Impurity is a correctness bug (ADR 0003).
2. **The server is the only authority.** The client simulates for feel and streams move logs; the
   server replays with the same engine and derives every score. Never trust a client-reported score.
3. **Nothing is copied from Puzzle Pirates.** No names the original coined, no art, no text, no
   audio. Generic puzzle names are fine (ADR 0001, ADR 0034).
4. **World content is files, not rows.** Outposts, lanes, raider tiers, ship classes live in
   `content` as JSON validated at startup (ADR 0009). Player state lives in Postgres.
5. **Every player-facing string goes through the message table.** English only, but never
   hardcode UI text.
6. **Every piece type is distinguishable without color.** Sprites have distinct silhouettes and surfaces; a player
   setting draws a distinct mark on every kind. Accessibility is not retrofitted.

## Stack

TypeScript, pnpm monorepo, Node 22. Packages: `engine`, `protocol` (Zod schemas), `content`,
`boards` (the PixiJS boards, round runner and server connection both front ends share, ADR 0019),
`server` (ws, Drizzle, Better Auth), `client` (the game: Vite, React, the three.js world, ADR 0020), `harness` (the puzzle test
bench at test.openseas.online: the practice pages plus lab rounds, inspector and replay review, and the voyage bench
for ships and crews, ADR 0027), `docs` (the puzzle guides: a static site with one guide per puzzle, its
pictures captured from the real boards on the harness, ADR 0038).
Postgres. Railway for server and database, Vercel for the game, the harness and the guides as three projects.
Vitest with property-based determinism tests on engines, Playwright smoke on all three front ends.

## Workflow

- Work on a branch, open a PR, the owner reviews and merges. CI must be green before review.
- Follow the milestone ladder in `docs/DESIGN.md` section 5.2. Do not start the next puzzle before
  the current one has shipped to its practice page.
- Property-based determinism tests are written before an engine is wired to the server.
- Record any new architecture decision as an ADR in the same PR.
- Record any deliberate divergence from the original in `docs/DESIGN.md` section 6.
- A prototype puzzle is a whole engine the server verifies, dealt only on the harness, in files of its
  own (ADR 0036). Promoting one into the game is its own ADR and milestone.
- A board change is proven in the harness: its smoke drives every board and must stay green. The
  harness is never linked from the game. `boards` is presentation and transport only: nothing in it
  may compute a score, and a lab round may never run on a config the server would refuse.
- Every puzzle has a guide in `docs`. A change to a puzzle's rules, scoring or controls re-reads its
  guide in the same PR; a change to how its board looks re-runs its capture
  (`pnpm --filter @openseas/docs capture <id>`). A guide types no tuned number: it reads `content`.
