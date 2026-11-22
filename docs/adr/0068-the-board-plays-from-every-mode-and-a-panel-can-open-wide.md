# 0068. The board plays from every mode, and a mode's panel can open wide over the middle

Status: Accepted. Supersedes decisions 1, 4 and 5 of
[0056](./0056-the-studio-is-laid-out-as-a-design-tool.md) where they say the board never moves,
what the Play panel holds, and that the panel never yields the middle. The rest of ADR 0056
stands. Builds on [0042](./0042-the-harness-becomes-the-puzzle-studio.md) decision 5.

## Context

ADR 0056 laid the studio out as a design tool and kept the board in the middle in every mode,
with every control for the round in the Play panel. In use, two things grated. Tuning a number
and trying it meant turning the rail to Play and back, because the round's controls (deal again,
a fresh seed, the shipped numbers held up) lived in a panel only Play shows. And the editors and
numbers panels were narrow: the Sprites grid, a cue's voices, a curve or a long list of strings
had a third of the page, while the middle held a board the owner was not looking at.

The owner settled the change on a whiteboard: the board stays in the middle and playable by
default; every mode but Play can open its panel wide over the middle, the board moving to the top
half of the chat's column and the chat to the bottom; and a bar of controls for the round sits
under the board in every mode.

## Decision

1. **A transport bar under the board, in every mode.** Start a round or go on with a paused one;
   pause; step a paused clock on (one tick of a ticked puzzle, a second of any other); deal the
   same seed again; deal a fresh seed (a pinned seed stays pinned, to the new one); hold up the
   shipped numbers; and the clock at half, normal or double speed, kept in the address as the
   `speed` the codec already read. The bar drives the round's `LabClock` and the frame's own
   start, which the puzzle's page publishes to it (`studio/roundClock.ts`); it makes and takes
   back no move. The Play panel's Round and Compare sections are gone: the bar holds them.

2. **A paused round is held under a veil.** The clock pausing does not stop a board taking
   moves, and an untimed board would let a held round be played on. In the studio a veil over the
   board takes every press while the round is held, and a press on it goes on. `/play` has no
   bar and no veil; a script's pause there (the guides' capture) is unchanged.

3. **No undo.** Considered and left out: the engines are pure, so a round could be rebuilt from
   its seed and its moves less the last, but a timed round's clock would have to be wound back
   with it, and the game never takes a move back. It can be added to the bar later.

4. **A mode's panel can open wide.** A button in the head of every panel but Play's opens it
   over the middle. The board then stands at the top of the right-hand column, still live and
   playable, and the chat takes the bottom. The board is one element in every layout, so a
   round in play carries on through a change of width or mode. Play never widens: its panel is
   short, and the board is what Play is for.

5. **One width for every mode, and the change is one motion.** Opening the panel wide in one
   mode opens it in every mode but Play; the choice is kept in the browser's local storage
   (`studio/wide.ts`), and a new page opens as the owner left it. The grid snaps to its new
   layout and each region then eases from where it was (`studio/wideMotion.ts`): the board and
   its bar fly and scale between the middle and the top of the right column, the chat slides
   between the column's top and its lower half, and the panel's edge sweeps open. Only transforms
   and a clip move, so the board keeps playing on the way; nothing moves for someone who asked
   for less motion. A choice of each mode's own width was tried and dropped as one more thing to
   set.

6. **A wide panel gets room before it gets features.** This step lays the numbers panels'
   sections out in columns when wide, and nothing more. Richer wide panels (the numbers in two
   columns with curves drawn large, the Sprites grid beside a larger editor, a cue's voices on a
   timeline, the shipped and draft words side by side) are the next step and need no decision
   beyond this one. Sprites and Sounds lose the wider column ADR 0065 gave them: closed, every
   panel is as wide as every other, and an editor that wants room opens wide.

7. **The Play panel's last rounds grow.** ADR 0056 had the Play panel record nothing new. Now
   each finished round keeps, beside the summary the agent was already told, its best combo and
   the numbers it was dealt on: what they changed from the content file, and the scenario's own
   numbers, read as the round was dealt. The page keeps twenty, newest first, in the tab's
   session storage; nothing is sent anywhere, and a message to the agent still carries the last
   five summaries alone, so the wire schema is unchanged. A round says how its score stands
   against the round before it, or against one the owner picks as the baseline; it can be dealt
   again on its seed; and its numbers can be laid back over the draft, after the owner says so,
   since that rewrites the draft.

8. **The studio's keys carry Alt.** The boards read plain letters and the space bar for play, so
   the studio's own keys are Alt and a key (P to pause or go on, R to deal the same seed, N a
   fresh one, `\` to open or shut the wide panel), matched on the key's place and caught before a
   board hears them. A press on the bar does not take focus, so Space and Enter stay the board's.

## Alternatives considered

- **The board in a floating window over the wide panel.** Movable, and it covers the panel it
  was moved aside for.
- **A smaller board left in the middle beside a wide panel.** Keeps the layout, and gives the
  panel little of what it was widened for.
- **The transport in the board's own details sheet.** It is there already in part, and a sheet
  hides the board it controls; `/play` keeps its sheet as it was.
- **Plain keys, as most tools have.** They would fight the boards for the same letters.
- **Sending each round's numbers to the agent.** Useful to it, and a change to the wire schema;
  left for when the agent is seen to need it.

## Consequences

- `PlayPanel` holds the stage, the starting points and the seed, then the round list
  (`studio/RoundList.tsx`); the frame's `rounds` are `PlayedRound`s (`frame/rounds.ts`), and
  the chat sends `toldRounds` of them.
- The smoke deals again with `transport-restart` and `transport-deal`, and holds the shipped
  numbers with `compare` on the bar.
- The page tells a board to size itself again when a panel opens or shuts wide, since a board
  sizes itself on the window's resize alone.
- The strings for the Play panel's Round and Compare sections are gone; the bar, the wide panel
  and the round list have strings of their own.
