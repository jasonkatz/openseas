# 0076. Stand-ins are four types on two dials, the same for every puzzle

Status: Accepted. Supersedes the puzzle domain guide's line that a puzzle has one stand-in, with a
standing set by hand. Builds on [0067](./0067-the-bots-live-in-the-repository.md).

## Context

The guide gave each puzzle between sides one stand-in with a hand-set standing. The game already has
more: Space Battle's raider tiers each set tokens, reloads, accuracy, aggression and thinking time, and
Swordfighting's raider crews play from a tier's swordsmen. Meanwhile the bots package plays any
prototype through one seam with players that know nothing of the puzzle: careless, one-move and
rollout. The owner wants a generic set of stand-ins that any puzzle can take.

## Decision

1. **Four types.** Careless plays any move the rules allow. Greedy plays the move worth the most now.
   Planner plays the move whose best few moves after it are worth the most. Ghost replays a player's
   own round from its log on the same deal.
2. **Two dials.** Delay, the time a stand-in takes over a move, and slip, the share of its moves made at
   random. A stand-in is a type and its dials; a host or a role picks one for a seat.
3. **A puzzle between sides takes every type** when its rules can list the moves a round allows and say
   what each is worth now, the seam the bots already use. A ghost also needs boards the other side
   cannot touch, so a puzzle says whether it takes ghosts. A puzzle may add stand-ins of its own.
4. **Standing is measured.** A stand-in starts where it lands against the other stand-ins and moves with
   its results against players, as a player's standing does. Nothing sets it by hand.

## Consequences

- The guide's Sides section and the puzzle document's `opponents` say so; the glossary gains stand-in
  type and dials. Delay is not called pace, which is already a word for performance in play.
- A raider tier becomes a stand-in plus whatever the role sets: its type and dials, and the settings a
  role may set for the round. Moving Space Battle and Swordfighting onto that is a change of their own.
- The bots package's generic players are the first three types. Ghost needs stored logs and a deal on
  streams of its own (ADR 0075).
