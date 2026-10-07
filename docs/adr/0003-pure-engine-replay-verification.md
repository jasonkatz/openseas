# 0003. Pure deterministic engine with server replay verification

Status: Accepted

## Context

Duty puzzles are single-player boards whose output drives a shared ship, so a cheater harms their
crewmates' experience. Options considered:

1. Client-authoritative boards reporting scores. The original's approach. Trivially cheatable.
2. Server-authoritative boards with every move round-tripping. Robust but laggy on phones.
3. Deterministic seeded boards: client simulates locally, streams its move log, server replays
   the same engine to verify and score.

## Decision

Option 3. The `engine` package is pure TypeScript with zero runtime dependencies, no I/O, no
timers, and no randomness except from an injected seeded PRNG. The server issues a seed per board.
The client runs the engine for instant feedback and sends its move log. The server replays and
derives the authoritative score. Divergence is rejected.

## Consequences

- Any impurity in `engine` is a correctness bug, not a style issue. Property-based tests assert
  determinism (same seed and moves give the same state) before an engine is wired to the server.
- Rendering, input, and animation live outside `engine`. The engine exposes state and a reducer;
  the client interpolates.
- Server CPU cost per puzzle is one replay, which is cheap at the target scale.
- The sea battle reducer and brigand AI live in `engine` for the same reason: server, client
  preview, and AI share one ruleset.
