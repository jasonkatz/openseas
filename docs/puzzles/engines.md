# Engines

Status: in the game. Built in M2. On the harness at `/engines`.

## The puzzle

Falling pieces you steer and rotate into a board, clearing by forming groups and
chaining through the board's structure. Performance feeds movement tokens per turn. QoL: ghost
piece showing landing position, next-piece preview, swipe-to-move and tap-to-rotate on touch.

## Role

A duty station: the drive console. Its output becomes the ship's movement tokens each turn (DESIGN.md 3.4), as a percent of `parScore`, capped by `outputCapPercent`; in a space battle those tokens are the captain's moves.

## Luck and skill

- **Luck:** the kinds each pair is dealt, and where a new injector lands.
- **First skill:** landing every pellet on purpose, and hurrying every pair: the round is its clock.
- **Second skill:** making both halves of a pair count, and keeping every injector able to fire.
- **Third skill:** making one firing feed the next. The chain table is steep (`chainMultipliers`), so one chain of three is worth more than many single firings.
- **Fourth skill:** building falls that feed falls for the top of the chain table, and never flaming out.

## Rules and scoring

A 12 wide by 20 tall drive core; the cells are small because nothing is tapped
individually, so the whole board fits a phone screen with room to work in. Pieces are fuel pellets, round discs rather than tiles, so Engines
never reads as Cooling: conjoined pairs of two pellets in three kinds (plasma, ion and fusion; drawn as riveted
discs: a red trefoil, a yellow three-spoke and cyan rings, each target ring in its piece's color),
each with an optional mark, and the two halves of
a pair stay visibly joined while both are on the board. Six injectors sit in the board at a time,
never touching. An injector is a connected shape of cells: a bar of two to four, a stack of two or
three, an L of three, or a two-by-two square; some cells are outlined round targets that want a
kind, the rest are blanks that hold anything. An injector cell has a shelf under it when no cell of
the same injector is directly beneath, so a pellet rests in a bar's cells or a stack's bottom cell
and the cells above fill by falling in, while any cell can be entered from the side. When every
target on an injector holds its kind the injector fires, its target pellets go, the shape is gone and
a new one is dealt elsewhere. Runs of
four or more of a kind, across or down, clear as well; crossing runs count as one group. Linked
halves fall together until one is cleared. Each step of a chain multiplies by `chainMultipliers`
(×1, ×3, ×6, ×10, and ×10 past that), steeply, because a chain through the core is the
skill of Engines; several groups in one step multiply by their count, as in Cooling. A run of n scores
`runPoints * (n - 3)`; an injector scores `injectorPoints` per target. If the core fills until
no pair can enter the top row, it flames out: every pellet is swept away, `flameoutPenalty` points are
lost (never below zero), the combo breaks, fresh injectors are dealt and play goes on. The round
ends on the clock; `maxMoves` only bounds the log. Every pair enters at the middle of
the top row; the move the engine logs is the position it came to rest in (column, row, rotation),
and the engine accepts it only if that spot is reachable from the entry by sliding, turning with
the same kicks the client uses (either direction), and falling, and nothing holds the pair there. So a pair can be
steered under an injector, a vertical pair can never straddle a shelf, and a position that floats is
refused.

## Input and feedback

The client's fall timer and steering are presentation: free fall takes `fallMs` a row, a
held downward swipe or holding space hurries it to `softDropMs` a row (sixteen times the pace), with
steering locked for the length of the swipe. There is no hard drop. A pair that comes to rest
locks after 350 ms; a slide or turn while resting restarts that timer at most three times, and
reaching a lower row restores the restarts. On the keyboard up and X turn the
pair counter-clockwise and down and Z turn it clockwise; a tap turns it clockwise.
The next pair is under the player's control the moment the last one lands, while the board below
plays out its clears, each cascade step waiting for the pieces to land before the next clear; the
pair after it is previewed in a strip above the core on every layout. The landing ghost is a
thin ring so the target under it stays readable, and glows when the pellet would fill a target of
its own kind. Sliding into a spot that rests (a shelf or a stack beneath) mid-fall sits the pair up
on it rather than letting it sink past.
Numbers live in `content/data/puzzles/engines.json`.

## Engine

`packages/engine/src/engines/`. Its header comment in `types.ts` states the rules; numbers are in
`packages/content/data/puzzles/engines.json`.

## Tuning notes

What was changed from the original and why is in `DESIGN.md` section 6, in the rows that begin
"Engines". New tuning is recorded here: what was tried, what the bots or testers scored, what was kept.

## Open questions for play

- None recorded yet. The tester sessions (DESIGN.md 5.2) are still to run.
