# 0066. A puzzle is learned on a ladder of stages, and only the whole puzzle counts

Status: Accepted. Builds on [0036](./0036-prototype-puzzles.md),
[0039](./0039-five-tiers-and-a-live-pace.md) and [0042](./0042-the-harness-becomes-the-puzzle-studio.md).
Changes two items of the `puzzles` skill's bar: rule 4 ("no levels to memorise") and rule 10 ("no
difficulty setting") now say what a stage is and is not. Salvage's ladder is the first.

## Context

A puzzle deepened until mastery takes real skill (Salvage's orders and volatiles, on top of its
lines, streak, crates and nets) is a lot to meet at once. The original taught its puzzles by
revealing them: a new player met a few rules, then more, and at some point the training wheels
came off and they had the whole thing. The owner asked for the same, and for the puzzles to grow
richer as a player gets into them. The design was settled with the owner question by question.

The bar said there is no difficulty setting and no levels to memorise. Both still matter: a player
must not farm an easy board for standing, and a round must never be a layout learned by heart. A
stage is neither: it is the same seeded puzzle with some of its layers switched off, met once on
the way in.

## Decision

1. **A stage is a ladder step, kept per player, that only goes forward.** A puzzle has two to four
   stages, simplest first, then the whole puzzle (`full`). Rounds within a stage keep whatever ramp
   the puzzle already has. A stage is not chosen down to once it is passed.
2. **Only the whole puzzle counts.** A stage's round is rated against its own thresholds and the
   tier is shown, but nothing reads it: no standing, no plunder, no title. Rule 15 of the bar holds
   for the whole puzzle alone.
3. **Deepen first, then cut stages out of the whole.** A stage holds nothing the whole puzzle
   lacks. It is made by switching layers off, never by adding a rule of its own.
4. **A stage is content.** A prototype's content file lists `stages`: each an id (a lowercase
   word, never `full`), a round length, thresholds, and a `config` laid over the puzzle's key by
   key. The overlay is held at load to the puzzle's own schema, and the studio's tests hold every
   stage to the engine's validator and the wire schema, so a stage is a config the server would
   deal. Engines know nothing of stages; each layer has an off value in config (Salvage:
   `loopMin: 0`, `orderLength: 0`, `volatileEvery: 0`, `streakPercent: [100]`, no crates).
5. **A stage keeps the verb and hides nothing.** A layer added in deepening uses the puzzle's one
   verb. The whole puzzle teaches every rule it has; mastery is in how the layers meet.
6. **A layer earns its place with bots.** Each new layer opens a measured gap between a bot that
   ignores it and one that plays it, and each puzzle has at least one bait: a play that looks right
   and loses. The design file keeps the bots and their scores.
7. **Teaching is a card and the moment itself.** Each stage has a name and a one-line card in the
   message table (`<puzzle>.stage.<id>`, `<puzzle>.stage.<id>_intro`, and the same for `full`),
   shown on the start card, and the board's own callout for a layer is its first lesson. No modal
   tutorial.
8. **A player moves up by one Steady round at a stage**, against that stage's thresholds. The first
   stage's rounds are a minute; each stage sets its own length.
9. **The studio deals any stage.** The Play panel has a stage picker, defaulting to the whole
   puzzle, and the address carries it (`?stage=lines`). A draft's numbers are laid over the stage
   played, the stage itself is a play setting like the seed and is not saved with a draft, and the
   HUD names the stage beside the score. Nothing in the studio climbs: the ladder that remembers a
   player's place, and a result card that says a stage is passed, come with the game, when a
   puzzle with stages is promoted.
10. **A puzzle's guide teaches its ladder,** one line a stage, read from content.

## Consequences

- Rule 4 and rule 10 of the bar now name a stage as allowed: a step of onboarding, forward only,
  rated by nothing.
- Promoting a prototype with stages needs player state for the ladder (a row a player and puzzle),
  the game's result card, and the server dealing a stage's config. That is the promotion's ADR.
- The seven puzzles in the game have no stages yet. They get them by their own decision, after the
  prototypes have shown the ladder works.
- A tester link freezes a draft's numbers and not a stage; a tester is sent a stage by its address.
