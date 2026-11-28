# 0098. Every solo puzzle is written on the new engine: Plating, Engines and Navigation join, the engine gains a ring board and signals in

Status: Accepted. Builds on ADR 0092 to ADR 0097 (the puzzle engine in rungs, and Cooling, Paths and Gunnery
written on it and played on their shipped pages through a mirror). Supersedes the first point of ADR 0097's
decision 7: the Cooling mirror now takes the ship's heat.

## Context

Seven puzzles ship in the game. Before this, three of them (Cooling, Gunnery, and Salvage as Paths) were
written on `@openseas/puzzle` and held to the engines the game ships. The owner asked for every puzzle to be
rebuilt as a definition on the new engine, extending the engine where a puzzle needs it, to see what a
definition looks like for each.

Two of the seven, Swordfighting and Battle, are fights between sides: several boards, or one board shared by
two ships, and opponents whose minds the reducer plays. That is rung 5, seats, which is its own decision.
The owner chose to keep it for the next change. This one covers the five solo puzzles.

Plating, Engines and Navigation each asked something the engine did not have, or showed a limit:

- Navigation is a round star chart. The domain guide has a ring board; the engine had only a grid.
- Cooling aboard a ship takes its heat from the ship, as moves in the shipped log. The domain guide calls
  that a signal in; the engine had none, so the mirror refused a heat move (ADR 0097).
- Plating's tray, breaches and plates all feed the one weld. A part reads only the board and its own state.

## Decision

1. **Plating, Engines and Navigation are puzzles on the new engine**, in
   `packages/puzzle/examples/<id>.puzzle.ts`. Each declares its numbers as settings, its scoring as payouts
   and multipliers, its streak as data, and keeps in parts of its own only what no stock part gives. Each has
   a test in `packages/puzzle/test/<id>.test.ts` that plays it beside the engine the game ships, from the same
   luck, and holds the two to the same board, terrain, score and streak after every move (and every stretch
   of ticks for Navigation). Plating and Navigation also hold the tray and the sky to the shipped engine's.
2. **A board may be rings.** `rings(rings, sectors)` declares `{ shape: "rings", rings, sectors }`, as the
   domain guide has it. A cell's `x` is its sector, counted clockwise from the top, and its `y` its ring,
   counted from the innermost: the guide's `RingCell` names (`ring`, `sector`) wait for cells to take names
   of their own in a later rung. On rings, `touching` gives the two cells around the ring, which wraps, and
   the ones in and out along the sector, and the board says how many rings and sectors it has.
3. **A signal in is an entry of the log.** A part declares the signals it takes (`signals`, each a number
   or a flag, with when it flows) and answers them in `onSignal`, one answer for each signal, merged as moves
   are. `signal(round, { signal, value }, { at })` plays one: every tick due first, then `onSignal`, Cascade,
   Move end and Close, as a move does. It is no move. It counts toward no budget, is no miss of the streak,
   and the rules are never asked whether it may come; a value outside what the signal declares is an error
   of the host's. The log holds it beside the moves, and `replay` plays both.
4. **Cooling takes the ship's heat as the signal `level`**, a number of rows. While the setting `shipHeat`
   is on, a move no longer moves the line; the board answers a new level with the move after it, as the
   shipped engine does. The Cooling mirror takes a heat move as that signal, and its test holds it to the
   shipped engine with heat moves between swaps.
5. **A part reads another's count, never its state.** Navigation's chart pays for the landings a
   constellation saved, and the sky counts them. The sky sets the stat `since_deal` on each landing and the
   chart sets it back to 0 when it charts: a stat is declared, shown and read by anyone, where a part's state
   is its own. Plating's tray, breaches and plates stay one part, `hull`, because the weld reads all three.
6. **What differs is written down, not tuned away.**
   - Plating's shipped engine rounds a seal to the nearest point. The loop rounds down once a move (ADR
     0093), so a seal can pay a point less. The test allows exactly that.
   - Navigation's shipped engine rounds each constellation down. The loop rounds once a move or a tick, so
     two constellations charted on one tick can pay a point more. The test allows exactly that.
   - The shipped engines end a round when no plate can be welded (Plating) or when a tick passes the last
     (Navigation). On the new engine a round ends by its clock or its budget only.

## Consequences

- Five of the seven shipped puzzles, and the Swap sample, are definitions on the new engine. Swordfighting
  and Battle wait for seats.
- Plating, Engines and Navigation have no page on the new engine yet. A mirror for each, as ADR 0097 gave
  the first three, puts them in the studio (ADR 0100).
- `Entry` is now a move or a signal. A host that reads a log entry asks which it is.
