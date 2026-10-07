# 0011. Puzzles first, each on a solo practice page

Status: Accepted

## Context

The game is only worth building if the puzzles are fun. Options: puzzles first, multiplayer
skeleton first, or a vertical slice of one puzzle plus one ship.

## Decision

Build the puzzle engines first, each shipped to a solo practice page with guest accounts and
ratings, tested by the tester group before the next starts. Order: Bilging, Sailing, Carpentry,
Gunnery, Navigation, Sea Battle, Swordfighting. Then the ship, voyage, combat, island, and crews
per the milestone ladder in `docs/DESIGN.md`.

## Consequences

- Testers have something to play from M1.
- Bilging, the simplest engine, proves the determinism and replay pipeline (ADR 0003) before
  harder engines depend on it.
- Multiplayer plumbing waits until M3, so the room abstraction (ADR 0005) is designed early but
  built later.
