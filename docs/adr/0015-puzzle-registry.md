# 0015. One puzzle registry drives every engine, and timed engines carry their clock in the move log

Status: Accepted

## Context

M1 wired Bilging straight through: the server session manager, the protocol, the content loader,
the ratings summary and the client round runner all named Bilging's types. M2 adds four more duty
puzzles (ADR 0011). Copying that wiring four times would mean four places to get authority wrong
(ADR 0003) and four sets of server tests.

Two of the new puzzles also strain the "move log fully determines the state" rule in different
ways. Gunnery is a real-time simulation in the original: pieces roll whether or not the gunner
acts. Navigation and Sailing have free actions (rotating a ring, steering a falling pair) that
happen far more often than scoring actions.

## Decision

1. **A registry of `PuzzleDef`s in `engine`.** Each engine stays its own strongly typed module
   and registers one object: `create`, `reduce`, `hash`, `summarize`, `validateConfig`,
   `isFinished`, `maxMoves(config)` and, optionally, `moveTimeMs(move, config)`. `PUZZLE_IDS` is
   the single list of puzzles. The server session manager, the client round runner and the
   generic tests drive engines only through this interface.
2. **Per-puzzle wire schemas, narrowed by the session.** `protocol` exports a move schema and a
   config schema per puzzle. `puzzle.move` accepts any puzzle's move on the wire; the server
   re-parses it against the schema of the session's puzzle, so a Bilging swap sent to a Sailing
   round is an illegal move, never an accepted shape. `puzzle.started` is a discriminated union on
   `puzzle`, so a client narrows the config by the id it asked for. The protocol's id enum and
   the engine's `PUZZLE_IDS` are checked against each other at compile time in the server.
3. **Timed engines put the clock in the move.** An engine that must advance without input
   (Gunnery) uses integer ticks. Every move carries the tick it happens at; the reducer advances
   the simulation to that tick, then applies the move. The client advances its copy for display
   with the same pure function and never logs ticks it did not act on, except a final `wait`
   so loads in flight count. The engine stays pure: ticks are data, not time. The server bounds
   the claim: a move whose tick is ahead of the wall clock since the round started (plus the
   latency grace) is rejected, so a client cannot run the simulation faster than real time.
   Claiming ticks *behind* the wall clock only hurts the claimant.
4. **Free actions are moves too, with a separate cap.** Rotations in Navigation and placements in
   Sailing are logged like any other move. `maxMoves` caps the log length the server will hold;
   engines that count something else as the round's budget (drops, pairs) carry their own cap in
   config. Steering a falling pair is not logged at all: Sailing's move is the landing column and
   rotation, and the engine drops the pair from the top, which is a documented divergence
   (DESIGN.md section 6).

## Consequences

- Adding a puzzle is: an engine module plus registry entry, a protocol file plus three
  registrations, a content file plus schema, and a client page. The server does not change.
- The summary every engine returns (`score`, `moves`, `bestCombo`) is the shape the database row
  and the result message already had, so M1 data stays valid.
- The practice page frame and lifecycle live once in the client (`puzzles/`). Bilging's M1 page
  keeps its own copy until a polish pass moves it over; new puzzles use the shared one.
- A timed engine's determinism tests must cover tick gaps, not just move sequences.
