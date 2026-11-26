# openseas

Browser-native, touch-first space pirate puzzle MMO. Spiritual successor to Puzzle Pirates: faithful
mechanics, original everything else. `openseas` is a codename. The game moved from the sea to space
in milestone M7 (ADR 0034): its words, its code, its three.js world and its puzzle boards (pieces
drawn in code, and sounds) are space. ADRs 0001 to 0033 keep the nautical words they were
written in.

## Read first

- `docs/DESIGN.md` is the source of truth for scope and product decisions. Read it before any
  feature work. If code and the design doc disagree, fix one in the same PR.
- `docs/adr/` holds the rationale for every architecture choice. Read the index. Never edit an
  accepted ADR's decision; add a superseding one.
- `docs/BRAND.md` is the brand book: the game's palette, type, shapes, motion, sound and voice
  (ADR 0061, ADR 0062). Read it before drawing, styling or wording anything a player sees. Every
  board, the chrome, the world and the sounds follow it.
- `docs/GLOSSARY.md` holds the game's words and the nautical words they replaced, with the
  identifier for each. Name new things by it, and read older ADRs through it.
- `docs/puzzles/DOMAIN.md` is the puzzle domain guide, the source of truth for what a puzzle is apart
  from any world: its round, depth, judgement, sides and skin, and the two documents that define one.
  Its words are in `docs/puzzles/CONTEXT.md`, and `CONTEXT-MAP.md` says how they meet the game's. Read
  it before shaping or naming anything about a puzzle. It is the target: where the code differs, a
  change to either is made in step with the other.
- `docs/puzzles/` holds a design file for each puzzle the game deals: its role, its rules and scoring,
  its luck and its skills. It changes in the same commit as the puzzle's rules or numbers.
- `docs/prototypes/` holds the prototype puzzles (ADR 0036): sixteen puzzles in the studio, none in
  the game yet (eight of the game's own, and eight early successors: Tractor to Treasure Haul, ADR 0078,
  Refining to Distilling, ADR 0080, Freefall to Treasure Drop, ADR 0081, Showdown to Poker, ADR 0082, Forging to Blacksmithing, ADR 0083, Assembly to Shipwrightry, ADR 0084, Pact to Spades, ADR 0087, and Pouring to Drinking, ADR 0085). Its README says what a prototype is made of and the rules it keeps; each puzzle has
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
6. **Every piece type is distinguishable without color.** Each kind on a board has a silhouette of its own and is
   told from every other by that alone (`docs/BRAND.md` section 3). Accessibility is not retrofitted.

## Stack

TypeScript, pnpm monorepo, Node 22. Packages: `engine`, `protocol` (Zod schemas), `content`,
`boards` (the PixiJS boards, each painting its pieces in code from drawings in `boards/data/pieces`, each puzzle's own cues in `boards/data/cues/<puzzle>.json` and the game's in `boards/data/cues.json`, the round runner and server connection both front ends share, ADR 0019, ADR 0062, ADR 0065),
`server` (ws, Drizzle, Better Auth), `client` (the game: Vite, React, the three.js world, ADR 0020), `studio` (the puzzle studio at studio.openseas.online, once the harness, built step by step, ADR 0042: a page a puzzle with its board and a tuning panel built from
`content` and the wire schema, each puzzle alone at `/play/<id>`, every round local, and the voyage bench for ships and crews, ADR 0027), `studio-server` (the studio's own small service: tester links by id,
the owner's GitHub sign-in, the owner's drafts, Save for their numbers, words and look as a draft pull request, and the chat's agent on a draft's worktree, ADR 0043, ADR 0045 to 0047, ADR 0049, ADR 0055, ADR 0057, ADR 0059, ADR 0060 and ADR 0065; the studio works without it), `bots` (the bot runner: bots that play any prototype engine and print its ladder table, `pnpm --filter @openseas/bots ladder <puzzle>`, a tool never deployed, ADR 0067), `docs` (the docs site at docs.openseas.online: a static site in three areas, the puzzle domain cut into pages from `docs/puzzles/DOMAIN.md`, the API of the puzzle, skin and theme documents as a typed reference in `packages/docs/src/api/schema` and the rules SDK in `packages/docs/content/api`, and one guide per puzzle, its
pictures captured from the real boards in the studio, ADR 0038, ADR 0091).
Postgres. Railway for server, the studio's service and database, Vercel for the game, the studio and the guides as three projects.
Vitest with property-based determinism tests on engines, Playwright smoke on all three front ends.

## Workflow

- Work on a branch, open a PR, the owner reviews and merges. CI must be green before review.
- Follow the milestone ladder in `docs/DESIGN.md` section 5.2. Do not start the next puzzle before
  the current one has shipped to its practice page.
- Property-based determinism tests are written before an engine is wired to the server.
- Record any new architecture decision as an ADR in the same PR.
- Record any deliberate divergence from the original in `docs/DESIGN.md` section 6.
- A prototype puzzle is a whole engine the server verifies, dealt only in the studio, in files of its
  own (ADR 0036). Promoting one into the game is its own ADR and milestone.
- A board change is proven in the studio: its smoke drives every board, on its `/play` page, and must stay green. The
  studio is never linked from the game. `boards` is presentation and transport only: nothing in it
  may compute a score, and a studio round may never run on a config the server would refuse.
- A key added to a puzzle's `config` gets one line of description on its wire schema (`.describe()` in
  `protocol`) and a place in the puzzle's `studio/src/tuning/groups/<id>.ts`: the studio's tuning panel is
  built from them, and its tests fail without them.
- A string a puzzle says is keyed `<puzzle>.<name>` in the message table: the studio's Text mode offers every
  such key for rewriting (ADR 0057), and Save writes a draft's rewrites back to the table.
- Every puzzle's content file has a `category`. It is a label for the studio's grid and decides nothing else.
- A piece's drawing is data in `boards/data/pieces/<puzzle>.json`, a cue's voices in the puzzle's own copy,
  `boards/data/cues/<puzzle>.json` (ADR 0065, ADR 0070): the studio's Sprites and Sounds editors change them in a draft and Save writes them. A
  puzzle's `pieces.ts` keeps only what code must say (a footprint, a numeral) and composes the drawings.
- A cue a board newly plays gets its place in `studio/src/assets/cues.ts`: the studio's Sounds list
  shows a puzzle's cues from it (ADR 0062), and its test fails without it.
- Every cue is synthesized, from its definition in `boards/data/cues/<puzzle>.json` or the game's `boards/data/cues.json`, by `docs/BRAND.md` section 8:
  one scale, soft, short. `studio/test/sound.test.ts` and `studio/e2e/sound.spec.ts` fail on one that is not.
  There are no samples and nothing generated lands in the game (ADR 0062).
- Any puzzle work, a new puzzle or a change to one, starts with the `puzzles` skill
  (`.claude/skills/puzzles/SKILL.md`): the rules every puzzle is held to.
- A pull request saved from the studio is a draft holding numbers and the chat agent's edits (ADR 0049). Whoever
  takes it on finishes it by the `puzzles` skill's "Changing a puzzle" before marking it ready.
- A change to `docs/puzzles/DOMAIN.md` is also a change to the docs site: a new section is given a page in
  `packages/docs/src/domain/pages.ts`, and a key added to a document's shape gets its typed field in the reference,
  `packages/docs/src/api/schema/`. The site's tests fail without them.
- Every puzzle has a guide in `docs`. A change to a puzzle's rules, scoring or controls re-reads its
  guide in the same PR; a change to how its board looks re-runs its capture
  (`pnpm --filter @openseas/docs capture <id>`). A guide types no tuned number: it reads `content`.
