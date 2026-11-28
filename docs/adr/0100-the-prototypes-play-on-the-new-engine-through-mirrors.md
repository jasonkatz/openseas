# 0100. The prototypes play on the new engine through mirrors: thirteen pages, each held to its own engine state for state

Status: Accepted. Builds on ADR 0097 (a shipped board plays on the new engine through a mirror) and ADR 0099 (the
prototypes are written on the new engine). Changes nothing about what the studio deals at `/<id>`: every prototype
still plays there on its own engine (ADR 0036).

## Context

ADR 0099 wrote thirteen solo prototypes on `@openseas/puzzle` and held each to its own engine in the puzzle
package's tests. Like the three of ADR 0097 before their mirrors, none could be played: the owner opened the studio
and found no prototype on the new engine.

## Decision

1. **Each of the thirteen has a mirror**, as ADR 0097 gave Cooling, Paths and Gunnery:
   `studio/src/rungs/mirror/<id>.ts`, a `PuzzleDef` whose round is played by the new engine and shown as the state
   the prototype's board draws. Each is at `/rungs/<id>` on the prototype's own page, alone at `/play/rungs/<id>`,
   and has a tile on the studio's home. Each page takes the puzzle it plays as a property, and a ticking page the
   function that lets time pass, defaulting to the prototype's own; the start card says which engine is behind it.
2. **Each mirror is held to its engine state for state** by `studio/test/mirror/<id>.test.ts`, as in ADR 0097: the
   same whole state and the same whole report after every move, and after every stretch of ticks on the three that
   tick (Overload, Refining, Deflectors). Each prototype's board smoke on `/play` runs on both engines.
3. **A name the engine gives and the new engine does not is given by the mirror**, from a number no piece reaches
   (1,000,000 on): Assembly's blueprints, Racks' crates, Refining's smoke. The tests compare ids as who they are,
   not as numbers, since the two engines number pieces from different starts.
4. **What the engine shows that no event carries is rebuilt from the shown state and then checked against the
   round**, and a mirror that finds the two disagree throws rather than show a board the round did not reach:
   Freefall's falling frames, Overload's waves, the slot each Pouring rival drank from and the kinds in a fresh
   bag, and Deflectors' beams.
5. **What differs is written down, not tuned away**, on top of ADR 0099's list:
   - Where an engine rounds down more than once a move (Scanner, Tug, Reactor, Tractor, Deflectors), the mirror
     shows the new engine's score, which is never behind and is ahead by at most a point a rounding. The tests
     compare the score and a move's points by themselves, within that bound. The parts of a report drawn for show
     (a wave's worth, a beam's) are worked out the engine's way.
   - Forging, Freefall, Pouring and Deflectors end on something other than the clock or the budget (ADR 0099,
     decision 6). Their mirrors end the round where the engine does, from the shown state.
   - The new engine refuses a move once its clock has run out, and the prototypes take one at their last tick.
     A ticking mirror runs the new clock a second past the prototype's last tick and ends the round at that tick.
     It plays only the prototypes' tick of 100 ms, and refuses a config with another.

## Consequences

- Every solo puzzle in the studio, but Showdown and Pact, can be played on the new engine on the page people know,
  and compared with its own engine by opening both on one seed.
- A mirror is still the studio's, and temporary (ADR 0097, decision 8). Thirteen more files and tests are the price
  of answering the question without touching a board.
- The studio's unit tests take about thirty seconds more.
