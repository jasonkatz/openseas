# 0036. Prototype puzzles: whole engines the server verifies, dealt only on the harness

Status: Accepted. Builds on [0015](./0015-puzzle-registry.md), [0018](./0018-one-experience-and-a-puzzle-harness.md),
[0019](./0019-boards-package-and-harness-bench.md) and [0028](./0028-standing-is-earned-in-the-game.md).

## Context

Every milestone on the ladder is built (DESIGN.md 5.2). The seven puzzles the game deals are
spiritual successors to the original's (ADR 0001). The owner wants new puzzles that are the game's
own: inspired by the original's feel, ported from none of it. Eight ideas survived a brainstorm, and
the owner asked to play all eight before choosing among them.

A puzzle cannot be judged on paper. It has to be played, with enough polish that a dull round is the
design's fault and not the build's. Until one is chosen it must cost the game nothing: no station,
no standing, no art pass, no place aboard a ship.

The harness already exists for exactly this (ADR 0018): a page per engine, lab rounds on a chosen
seed and config, the inspector, the replay check and log review. And ADR 0015 already says what
adding a puzzle costs: an engine with a registry entry, a protocol file, a content file and a page,
with no change to the server.

## Decision

1. **A prototype is a whole puzzle, registered like any other.** Its engine is pure and replayable
   (ADR 0003), it has wire schemas, a content file and thresholds, and `PUZZLE_IDS` lists it. A
   recorded round on the harness goes through the server, which replays and scores it as it does
   every round. Nothing about a prototype is second-class except where it is dealt.
2. **Only the harness deals one.** `PROTOTYPE_PUZZLE_IDS` names them apart from `CORE_PUZZLE_IDS`.
   A prototype is no station: it has no `parScore`, no `station.*` strings, no place in a ship
   class, and the game never starts one. Harness rounds move no standing (ADR 0028), so a prototype
   earns none and appears on no pirate's card. The harness home page lists prototypes in a section
   of their own.
3. **A prototype owns its files.** So that one is promoted or dropped by its own files plus the
   lines that register it:
   - `engine/src/<id>/` and `engine/test/<id>.test.ts`. The module exports its own `PuzzleDef`
     (`<ID>_DEF`), which `registry.ts` only lists. `PuzzleDef` moved to `engine/src/def.ts` so an
     engine can export one without importing the registry.
   - `protocol/src/<id>.ts`: the move and config schemas.
   - `content/data/puzzles/<id>.json` and its schema in `content/src/prototypes/<id>.ts`.
   - `content/data/messages/prototypes/<id>.json`: the puzzle's strings. The loader merges these
     into the one message table (CLAUDE.md rule 5) and refuses a key that is in two files.
   - `boards/src/<id>/`: the renderer and its React host.
   - `harness/src/pages/<Id>Practice.tsx`, `harness/src/prototypes/<id>.ts` (the bench entry and
     seed probes), `harness/src/scenario/prototypes/<id>.ts` (lab presets) and
     `harness/e2e/<id>.spec.ts` (its smoke).
   - `docs/prototypes/<id>.md`: its design, kept true as it is tuned.
4. **Prototype boards are built from a kit, with placeholder art.** `boards/src/kit/` holds a
   PixiJS base class (`KitBoard`), a tween clock, an effects layer (popups, callouts, bursts, rings,
   beams, flash, shake) and vector pieces drawn in code: eight kinds that differ by silhouette
   first and color second, with pips for the mark setting (rule 6). A kit board speaks the same
   contract as the hand-built ones: `setState`, `setInteractive`, `setShowMarks`, `keyboard`, a
   `<id>-canvas` test id and a `data-view` that must equal the board's `data-board` once settled.
   The kit computes no score: every number a board shows comes from an engine function.
5. **Promoting a prototype is a decision of its own.** A puzzle that is kept gets a role in the
   game (a station, a haul after a fight, an outpost job), its ADR, its place on the milestone
   ladder, and the owner's sprite pass. A puzzle that is not kept is deleted by removing the files
   above and the lines that name it.
6. **Thresholds are guesses.** Each prototype's thresholds were set from bots playing its engine,
   not from testers. They exist so a round gets a performance rating at all (ADR 0028) and are
   retuned when people have played.

## Consequences

- The server did not change. It deals a prototype to anyone who asks for one by id, as it deals any
  puzzle on the harness; the round is verified, kept and unrated.
- `PUZZLE_IDS` is now fifteen ids. Code that means "the puzzles the game deals" uses
  `CORE_PUZZLE_IDS`; `DUTY_PUZZLE_IDS` is unchanged.
- The message table is read from more than one file. `en.json` stays the game's; a prototype's
  strings move into it if the prototype is promoted.
- Scanner hides its contacts from the player, but the client holds them: the seed deals them, and
  the client runs the same engine. That is true of every puzzle's future (the next star, the next
  pair) and harmless for those. For a puzzle whose whole game is hidden information it means a
  cheat is trivial, so a Scanner that counted for anything would need the server to answer pings.
  That is noted here and in its design, not solved: nothing a prototype scores counts.
- The kit is for prototypes. A promoted puzzle may keep its kit renderer under the owner's sprites
  or get a hand-built one; that is decided when it is promoted.

## Alternatives considered

- **Prototypes outside the registry, as harness-only code.** Rejected: the bench (lab rounds, the
  inspector, the replay check, log review) drives engines through `PuzzleDef`, and a recorded round
  is the cheapest proof an engine is deterministic across client and server. A puzzle built outside
  the registry would have to be rebuilt to be promoted.
- **Paper designs first, then build the best three.** The first plan. The owner chose to see all
  eight, which is the better test: several of these read better than they play, or the reverse.
- **Hand-built renderers like the game's boards.** Each of those is a thousand lines or more. Eight
  of them for puzzles that may be dropped is the wrong cost; a kit gives every prototype the same
  feedback vocabulary for a third of the code.
