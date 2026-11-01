# 0018. The ship is a pure reducer on a turn clock; duty boards bind to stations and feed it per turn

Status: Accepted

## Context

M3 puts a crew on one ship and sails it between two islands (DESIGN.md 5.2). The duty puzzles
exist as practice rounds: a seed, a move log, a server replay, a score (ADR 0003, ADR 0015). The
ship needs those scores to mean something every ten seconds, and the rules in DESIGN.md 3.4 (turn
clock, unstaffed stations, grace periods, encounters) need a home that can be tested without a
server. Options for the simulation: a service in `server` mutating rows, or a reducer in `engine`
like the puzzles. Options for duty boards: one endless board per station, or rounds.

## Decision

1. **The ship simulation is an engine module.** `createShip`, `reduceShip` and a move log, like
   every puzzle. Moves are crew events (`board`, `leave`, `station`, `wheel`, `away`, `back`),
   captain orders (`sail`, `evade`, `lock`), `duty` reports and `turn`. The server applies `turn`
   every `turnSeconds`; the reducer never reads a clock. Every quantity is an integer: water and
   damage in permille, speed in permille of full, progress in units where a leg of n seconds is
   `n * 1000` long and a turn at full speed covers `turnSeconds * 1000`, so a fully crewed ship
   at par makes a leg in exactly its nominal time. Encounters are rolled from the ship's seeded
   PRNG when it sails. Same seed and same move log give the same ship.
2. **A station's output is points per turn as a percentage of par.** Each puzzle's content carries
   `parScore`, the score a steady player makes in a practice round; the server scales it to one
   turn. Every turn the server takes each station board's score since the last turn and hands it
   to the reducer as a `duty` move; the reducer turns it into percent of par, capped, and applies
   the tuning in `content/data/world/ocean.json`: pumping, repair, speed, cannon loading, tokens.
   An unstaffed station reports nothing.
3. **Duty boards are practice-length rounds dealt back to back.** A pirate at a station at sea is
   dealt a board through the same session manager as practice, bound to the ship, station and
   voyage; moves flow over the same `puzzle.move` message. When the board's clock runs out or the
   engine ends it, the client asks for the next. A board cut short (the ship docked, the pirate
   stood down, dropped or went ashore) counts and feeds the ship what it earned, but is stored
   unrated. Only boards that ran their full clock move a rating, so the practice thresholds stay
   valid at sea.
4. **Ships are rooms; little is persisted.** A ship with anyone aboard is an in-memory room
   (ADR 0005) that broadcasts a whole snapshot after every change and every turn; the client
   renders it and simulates nothing. The database keeps where each ship and pirate is, a row per
   voyage with its crew, and the duty rounds. A server restart puts every ship back in port with
   its voyage left open; that is accepted for v1.

## Consequences

- The ship's rules have property-based determinism tests like every engine, and the sea battle
  (M4) slots in as more moves on the same reducer.
- Tuning is content: `ocean.json` for the ship, `parScore` per puzzle. The first numbers are
  guesses to be fixed in the M3 tester session.
- Three deliberate differences from the original follow from this and are recorded in DESIGN.md
  section 6: hull wear at sea, boards in rounds rather than one endless board, and an empty ship
  returning to port.
- The Bilging board's water level is still its own (DESIGN.md 3.3); feeding the ship's bilge into
  the board's log is left for a later pass, since server-injected moves need an ordering rule
  the replay model does not yet have.
