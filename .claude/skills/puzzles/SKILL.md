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
   understands the scoring: the input lands at once, every move plays back, clears burst, big moves
   get a callout, a shake and a sound. Feedback is part of the design, built with the first
   playable, and it never holds input back.
2. **One verb, learned in a minute.** Touch-first, one thumb, portrait (landscape only where the
   board is a map). A new player makes a scoring move in their first ten seconds. Keyboard plays
   every puzzle on desktop.
3. **A loop that asks for one more round.** A round is short, always ends on something the player
   could have done better, and starts again in one tap. Within a round the loop is tight: act, see
   the payoff, spot the next thing, in a few seconds.
4. **Never the same round twice.** The seed deals it. There are no levels to memorise; where a
   fixed layout would let a player work off one trick all round, deal a new one.
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
    opponent's tier (`scorePercent`).
11. **Hints teach, never play.** An idle hint in unrated and lab rounds only. A round that counts
    never hints.

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
17. **Thresholds come from a bot ladder, then from people.** Write bots from careless to expert and
    set the tiers between them. A degenerate bot (spam, sweep, gamble) must land a tier below a plain
    thinking one; if it does not, the rules are wrong, not the thresholds. Record the bots and
    their scores in the tuning notes.
18. **Numbers live in content.** Every tuned number is a named key in
    `content/data/puzzles/<id>.json`. The board shows only what an engine function computed.

### Purpose

19. **A puzzle has a role, or is a prototype.** In the game, a round does something for someone:
    today a station feeding the ship or a fight, later whatever the game needs (a haul, an outpost
    job, a craft). The design file's Role section says what, and what the tier changes. A
    prototype names the roles it could take.
20. **Whole on its own.** It is a complete, fun round alone on the harness, with no ship behind it.
    What the wider game injects (Cooling's heat) arrives as moves in the log.

### Clear-cut

21. **Pure engine, server authority.** Deterministic from seed and move log; determinism property
    tests are written first; the server replays and scores every round. A puzzle whose game is
    hidden information counts for nothing until the server holds the secret (Scanner, ADR 0036).
22. **Reads without color.** Each kind has its own silhouette, and the mark setting draws a distinct
    mark on each.
23. **Its own sprites and sounds.** Each frame, named as the renderer asks for it, is described in
    the puzzle's sprite brief and made with the `puzzle-sprites` skill; each moment item 1 asks to
    be heard has a cue in its sound brief, made with the `puzzle-sounds` skill. The owner picks
    every take. Every piece keeps a code-drawn fallback and every cue a synthesized one
    (`boards/src/audio.ts`, ADR 0041), and marks, numerals and hit areas stay in code. A puzzle
    without its sheet is not finished; say so.
24. **Every string in the message table.**
25. **Three homes, kept in step.** A harness page with bench entry, lab presets and a smoke that
    plays by key and by pointer; a guide in `packages/docs` with captured pictures and no typed
    number; and, once it has a role, its place in the game. Plus the design file.

## New puzzle

1. Pitch it against the bar before any code: the verb, the compound move, luck and skill with four
   skills, how it tiers, the roles it could take. A pitch that cannot fill one of those in is not
   ready. Done when the owner has picked it.
2. Build it as a prototype (ADR 0036): copy Salvage's files as `docs/prototypes/README.md` lists,
   determinism tests first, feedback with the first playable.
3. Write the bot ladder, tune against it, set the thresholds, and write the tuning notes.
4. Write the design file, the guide and its capture, and the sprite and sound briefs; make their
   takes with `puzzle-sprites` and `puzzle-sounds` for the owner to pick.
5. Report the bar, item by item, with the open questions for play.

## Changing a puzzle

1. Read its design file and its guide. State which bar items the change touches.
2. Make the change, and in the same commit:
   - **A rule or a number:** the design file; the guide re-read against the engine; the bot ladder
     re-run and thresholds moved if tiers shifted; a `DESIGN.md` section 6 row if it departs
     further from the original.
   - **A control:** the design file, the guide's controls, the harness smoke.
   - **A look or a sound:** `pnpm --filter @openseas/docs capture <id>`, and every picture looked at.
     New pieces need new frames and new feedback new cues: add them to the briefs and make their
     takes with `puzzle-sprites` and `puzzle-sounds`.
3. Done when the harness smoke and the docs tests are green and the bar items you named are
   reported as still met.

## Promoting

Its own ADR and milestone (ADR 0036, `docs/prototypes/README.md`). Before proposing one: the owner
has played it, people (not only bots) have set its thresholds, its Role section says what each
tier does for the game, and its design file moves to `docs/puzzles/`.
