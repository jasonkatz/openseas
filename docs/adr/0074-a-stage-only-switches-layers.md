# 0074. A stage only switches layers

Status: Accepted. Supersedes the parts of [0066](./0066-a-puzzle-is-learned-on-a-ladder-of-stages.md)
decision 4 that give a stage its own round length, thresholds and a `config` laid over the puzzle's
key by key, and decision 8's sentence that each stage sets its own length and that a player moves up
by a Steady round against the stage's own thresholds. Builds on
[0072](./0072-a-round-keeps-one-difficulty-and-the-stage-sets-it.md).

## Context

The puzzle domain guide (`docs/puzzles/DOMAIN.md`) cuts a stage out of the whole puzzle by switching
layers off, and moves a player on when they clear the stage's threshold. Content does more: each of
Salvage's stages carries its own round length, its own six thresholds and a `config` overlay that can
set any key. A stage could then be the puzzle with other numbers, not only with fewer rules, and the
guide's puzzle document had nowhere to say so. The owner does not want settings to vary stage by stage.

## Decision

1. **A stage changes nothing but which layers are on.** Its round length, every setting and the tier
   starts are the whole puzzle's.
2. **A layer off needs no value.** A setting a layer brings exists only while the layer is on, so a
   stage names layers and never numbers. The off values content holds today (`loopMin: 0`) are how an
   engine is told a layer is off, not a part of the puzzle.
3. **A stage keeps its threshold.** The bar to move on is the stage's threshold in its measure, as the
   guide's ladder says. The tier a stage's round lands in is read off the whole puzzle's tier starts,
   and nothing reads it.

## Consequences

- The guide's ladder says so; its puzzle document already gives a stage only its layers and threshold.
- Salvage's content, the studio's stage picker and the engines' off values move to this by a change of
  their own: each stage's `roundSeconds`, `thresholds` and non-layer keys go, and its `config` is
  derived from the layers it has on. The first stage's minute-long round goes with them.
- A stage's round plays as long as the whole puzzle's. If that proves too long for a first stage, the
  answer is a smaller first stage, not a shorter clock.
