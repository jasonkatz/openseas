---
name: puzzles
description: The rules every openseas puzzle is held to, and the checklists for making or changing one. Use when inventing or pitching a new puzzle, building a prototype, promoting one into the game, or changing any existing puzzle's rules, scoring, numbers, controls, board art or feedback.
---

Every puzzle, in the game or a prototype, is held to the **bar** below. Pick your branch, do its
checklist, and finish by reporting each bar item as met, or as broken with the reason. A broken
item is the owner's call: say it plainly, never tune around it silently.

- **A new puzzle** (an idea, a pitch, a prototype): [New puzzle](#new-puzzle).
- **A change to a puzzle** (a rule, a number, a control, a look): [Changing a puzzle](#changing-a-puzzle).
- **Promoting a prototype into the game**: [Promoting](#promoting).

The puzzle's **design file** is `docs/puzzles/<id>.md` (in the game) or `docs/prototypes/<id>.md`
(a prototype). Read it first, with a neighbour's for the shape. File lists live in
`docs/prototypes/README.md` (what a puzzle is made of, the board kit) and `packages/docs/README.md`
(the guide and its pictures); follow them, they are not repeated here.

## The bar

### Feel

1. **It feels great in the hand.** The first move of a first round is satisfying before the player
   understands the scoring: the input lands at once, every move plays back, a clear is seen and
   heard, and a big move gets a callout, a sound and the beat (`docs/BRAND.md` section 6: one amber
   pulse of the board, never a shake or a shower of particles). Feedback is part of the design, built with the first
   playable, and it never holds input back.
2. **One verb, learned in a minute.** Touch-first, one thumb, portrait (landscape only where the
   board is a map). A new player makes a scoring move in their first ten seconds. Keyboard plays
   every puzzle on desktop.
3. **A loop that asks for one more round.** A round is short, always ends on something the player
   could have done better, and starts again in one tap. Within a round the loop is tight: act, see
   the payoff, spot the next thing, in a few seconds.
4. **Never the same round twice.** The seed deals it. There are no levels to memorise; where a
   fixed layout would let a player work off one trick all round, deal a new one. A stage of the
   puzzle's ladder (rule 26) is no level: it is the same seeded puzzle with layers off.
5. **A moving skill ceiling.** Competence comes in an evening; mastery is reachable; true expertise
   is rare and visibly different. The design names at least four skills in the order a player
   learns them, each paying clearly more than the last, and the top one is still hard for someone
   who knows exactly what to do. If the best bot plays perfectly by a simple rule, the ceiling is
   too low.
6. **A named compound move.** One line says what the puzzle pays most for (Salvage's net, Cooling's
   slag lifted together). It is planned, it takes setup, and a new player would not find it by
   accident.
7. **Luck deals, skill decides.** The design file lists what is luck and what is skill. Luck is
   bounded (a shuffled bag, a shared stream, a deal checked to be playable). Whatever the player
   must plan around is shown to them: previews of what a move will do, what is coming next.
8. **A mistake costs, it does not end the round** (a flameout, a lost heading). No undo. When a deal
   could force a guess, deal again: a penalty must always have been avoidable.
9. **The game's own.** Faithful mechanics for the seven successors, original everything else; a new
   puzzle is ported from no existing game. No name, art, text or sound from Puzzle Pirates or
   another known game. Names follow `docs/GLOSSARY.md`.

### Difficulty

10. **No difficulty setting.** Skill shows as score. The round ramps itself where it suits the
    puzzle (a quicker feed, bigger targets), and a board against an opponent scales by the
    opponent's tier (`scorePercent`). A stage (rule 26) is onboarding, not a setting: forward
    only, and its tier is read by nothing.
11. **Hints teach, never play.** An idle hint in a studio round only. A round that counts never
    hints.

### Scoring

12. **Score is points in a round on its clock.** Round length is the puzzle's own choice, in
    content. `maxMoves` only bounds the log. A score never goes below zero.
13. **Planned beats lucky.** The compound move pays superlinearly (n × n, k × k); anything a lucky
    refill can do is capped (a cascade table that flattens, a capped streak). Streak rules (a cap,
    a forgiven setup move) are chosen per puzzle and argued in its tuning notes.
14. **No single mechanic is the whole round.** If one thing is more than about half of a good score,
    retune it.
15. **The tier is the result, never the bare score.** A score means nothing from one puzzle to the
    next. Every round ends in one of the five tiers (Green, Steady, Sharp, Masterful, Legendary; ADR
    0039), read from the puzzle's thresholds in content, and the result card leads with it. **The
    tier is what the rest of the game should read**: whatever a round does for a ship, a purse or a
    pirate's standing is a function of its tier, so puzzles with wildly different point scales
    weigh the same. Standing already works this way. A station still pays the ship by percent of
    `parScore` (ADR 0030); moving that onto tiers is its own ADR, so until then build no new reader
    of a raw score, and raise the gap when your work touches one.
16. **The HUD shows the tier being played at.** Every board carries the live tier indicator
    (`useTierPace` and `TierPace` in `boards`): the last `paceSeconds` of play read as a whole
    round. Set `paceSeconds` in the puzzle's content to about two of its scoring events, ten
    seconds for a puzzle that scores every move and longer for one that scores in lumps, then
    watch a round: the reading should move with how you are playing, neither stuck nor strobing.
    A puzzle whose score is not points over a round hands the hook an engine function that reads
    a stretch as a score (Swordfighting's `swordfightPaceScore`).
17. **Thresholds are tuned by hand, in the studio.** `thresholds` and `paceSeconds` are controls
    on the puzzle's studio page like any number (ADR 0042): play rounds there with the HUD's tier
    in view and move them until each tier names the play it is given for. A bot ladder (bots from
    careless to expert, the tiers set between them) is a tool for a first guess or a doubt, not a
    step every change repeats. One thing it checks still holds however the numbers were set: a
    degenerate way to play (spam, sweep, gamble) must land a tier below plain thinking play; if
    it does not, the rules are wrong, not the thresholds. The tuning notes say why the thresholds
    sit where they do, and keep any bots and their scores.
18. **Numbers live in content.** Every tuned number is a named key in
    `content/data/puzzles/<id>.json`, and so a control on the puzzle's studio page: its wire schema
    bounds it and says in one line what it does (`.describe()`), and
    `studio/src/tuning/groups/<id>.ts` gives it a section. The board shows only what an engine function computed.

### Purpose

19. **A puzzle has a role, or is a prototype.** In the game, a round does something for someone:
    today a station feeding the ship or a fight, later whatever the game needs (a haul, an outpost
    job, a craft). The design file's Role section says what, and what the tier changes. A
    prototype names the roles it could take.
20. **Whole on its own.** It is a complete, fun round alone in the studio, with no ship behind it.
    What the wider game injects (Cooling's heat) arrives as moves in the log.

### Clear-cut

21. **Pure engine, server authority.** Deterministic from seed and move log; determinism property
    tests are written first; the server replays and scores every round. A puzzle whose game is
    hidden information counts for nothing until the server holds the secret (Scanner, ADR 0036).
22. **Reads without color.** Each kind has a silhouette of its own and is told from every other by
    that alone: look at the board with every piece in one colour (`docs/BRAND.md` section 3). Where
    the rules fix the outline, each kind carries one cut-out no other has. There is no marks
    setting to lean on.
23. **Its own pieces and sounds.** A puzzle's pieces are pictograms of its own subject, drawings
    in `boards/data/pieces/<id>.json` painted in code by its `pieces.ts` on the shared palette
    (`docs/BRAND.md` section 3, ADR 0062, ADR 0065; Cooling's is the model), and each moment item 1
    asks to be heard has a synthesized cue: one of those in its own `boards/data/cues/<id>.json` (ADR 0070), with its
    parameters in `boards/src/cues.ts`, in the one key and voice of `docs/BRAND.md` section
    8, played through `sfx`. The beat has one sound on a board, the puzzle's own copy (ADR 0071), and a board plays
    no cue of its own over it. Nothing generated lands in the game: no picture is made for a
    piece and no sample for a cue, and there is no tooling to make either with (ADR 0062).
24. **Every string in the message table.**
25. **Three homes, kept in step.** A studio page with its entry, starting points, a line of
    description on every config key and a place for it in the tuning panel, and a smoke that
    plays by key and by pointer; a guide in `packages/docs` with captured pictures and no typed
    number; and, once it has a role, its place in the game. Plus the design file.

### Depth

26. **Deep enough to need a ladder, and laddered** (ADR 0066). A puzzle grows layers until mastery
    takes real skill, feel for how scoring works and a sense of what is not worth chasing, and is
    then learned on a ladder of two to four stages before the whole puzzle. Each layer uses the
    one verb, has an off value in config, and earns its place with bots: a bot that plays it beats
    one that ignores it by a measured margin, and at least one bait (a play that looks right) loses
    to plain good play. Stages are cut from the whole puzzle by switching layers off, never given
    rules of their own; each lives in the content file's `stages` with its round length,
    thresholds, name and one-line card (`<puzzle>.stage.<id>`, `_intro`, and the same for `full`).
    The guide teaches the ladder. A puzzle not yet deepened has no stages and says so in its design
    file.

## New puzzle

1. Pitch it against the bar before any code: the verb, the compound move, luck and skill with four
   skills, how it tiers, the roles it could take. A pitch that cannot fill one of those in is not
   ready. Done when the owner has picked it.
2. Build it as a prototype (ADR 0036): copy Salvage's files as `docs/prototypes/README.md` lists,
   determinism tests first, feedback with the first playable.
3. Set the thresholds: a bot ladder for the first guess where it helps, then by hand in the
   studio (rule 17). Describe every config key and give it its section of the tuning panel (rule
   18). Write the tuning notes.
4. Draw its pieces as drawings in `boards/data/pieces/<id>.json`, painted by its `pieces.ts`
   (the studio's Sprites editor draws them too), and look at the board with every piece in one
   colour (rule 22). Give each moment its cue, copied into its own `boards/data/cues/<id>.json` from
   `boards/data/cues.json`, and list them in `studio/src/assets/cues.ts`. Write the design file, the guide and its capture.
5. Once it plays whole, cut its ladder (rule 26): stages in content, a bot score for each, the
   guide's ladder.
6. Report the bar, item by item, with the open questions for play.

## Changing a puzzle

1. Read its design file and its guide. State which bar items the change touches.
2. Make the change, and in the same commit:
   - **A rule or a number:** the design file; the guide re-read against the engine; the tiers
     looked at again in the studio and the thresholds moved if they shifted; a `DESIGN.md` section
     6 row if it departs further from the original. On a puzzle with stages, every stage the
     change reaches: its overlay still switches the layer off, and its thresholds still fit.
   - **A new layer:** its off value, the stage it arrives at, and the bots that show it pays for
     skill and that its bait loses (rule 26). The bots live in `packages/bots/src/games/<id>.ts`;
     `pnpm --filter @openseas/bots ladder <id>` prints the table for the tuning notes (ADR 0067).
   - **A new or renamed config key:** its line of description on the wire schema and its place in
     `studio/src/tuning/groups/<id>.ts`.
   - **A control:** the design file, the guide's controls, the studio smoke.
   - **A look or a sound:** `pnpm --filter @openseas/docs capture <id>`, and every picture looked at.
     A look follows `docs/BRAND.md`: a piece is a pictogram drawn in `boards/data/pieces/<id>.json`
     and painted by the puzzle's `pieces.ts`, a cue is voiced in the puzzle's own `boards/data/cues/<id>.json`, and every
     colour comes from `boards/src/look/tokens.ts` (`studio/test/look.test.ts` fails on one typed
     anywhere else).
3. Done when the studio's tests and smoke and the docs tests are green and the bar items you named are
   reported as still met.

## Promoting

Its own ADR and milestone (ADR 0036, `docs/prototypes/README.md`). Before proposing one: the owner
has played it, people (not only bots) have set its thresholds, its Role section says what each
tier does for the game, and its design file moves to `docs/puzzles/`. A puzzle with stages also
needs the ladder's player state, the server dealing a stage, and a result card that says a stage is
passed (ADR 0066 decision 9).
