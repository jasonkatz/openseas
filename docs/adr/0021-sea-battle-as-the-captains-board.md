# 0021. Sea Battle is the captain's board: a turn-commit engine with the brigand inside it

Status: Accepted. Builds on [0003](./0003-pure-engine-replay-verification.md),
[0015](./0015-puzzle-registry.md), [0019](./0019-boards-package-and-harness-bench.md) and
[0020](./0020-three-js-world-with-boards-over-it.md).

## Context

M4 brings the sea battle (DESIGN.md 3.3): the captain's game against an AI brigand on a grid of
water, rocks, winds and eddies, with movement tokens from Sailing, loads from Gunnery and hull from
Carpentry, resolving once per ship turn, ending in a boarding that M4 stubs. It had to fit the
rules already in force: a pure engine with server replay (ADR 0003), one registry driving every
engine (ADR 0015), boards that compute no score (ADR 0019), the ship owned by the server on a turn
clock (ADR 0020), and a practice page in the harness before the game embeds it (ADR 0011).

Three things were open: where the brigand's mind lives, how the ship's numbers reach a board the
server replays, and what drives the turn.

## Decision

1. **The battle is a puzzle in the registry, `battle`, and the brigand lives inside the reducer.**
   One `commit` move carries the captain's whole plot for a turn: up to `segments` moves (left,
   forward, right or a hold) with port and starboard fire per move, and a grapple flag. The
   reducer chooses the brigand's plot from the seeded PRNG, then sails both plots segment by
   segment at once: the moves, then the winds and eddies, then the guns, then a grapple or a
   crippled hull. The AI is a scripted policy: it guesses the captain will repeat last turn, sails
   every plot its tokens allow through the same resolution, scores broadsides lined up against
   broadsides walked into, rocks, closeness and boarding, and fires what it meant to with the
   tier's accuracy. Because every roll is the fight's PRNG, the move log replays the brigand
   exactly, and the harness can review a fight move by move like any other round.
2. **The ship's word reaches the board as `supply` moves the server vouches for.** Aboard, the
   config's `supply` is null and every ship turn the server announces a deal: tokens from the
   turn's output, the ship's loaded cannons and its hull. The captain's board logs it as a
   `supply` move; the server accepts only the deal it announced, once, the way a Bilging board
   aboard logs the bilge (DESIGN.md 3.3). After each committed turn the server reads the turn
   report and feeds the ship what the fight did: `fired` shots leave the magazine, `hit` damage
   reaches the hull. The ship stays the authority on hull and loads; the fight is the authority
   on what happened in it. In practice the config supplies the board itself each turn.
3. **The turn is the captain's commit; the ship's clock sails what is plotted.** The engine has
   no clock. In the game the board commits when the ship's next turn fires; in the harness, when
   the practice turn clock does. A captain who drops leaves the fight waiting: supplies pile up to
   the cap, nothing resolves, and on reconnect the server hands the board back with every move so
   far (`resume` on the deal) so the client replays it silently and carries on. Past the grace
   period the seat is given up and the fight breaks off as a disengagement.
4. **Tiers are content.** A brigand tier is its tokens per turn, reloads per turn, accuracy and
   aggression in `brigand-tiers.json`, plus the booty on a win; the board's rules, the maps and
   the practice brigand are `puzzles/battle.json`. Harder is faster, better armed and smarter
   about closing, not a different rule set.
5. **Booty is split by shares weighted by duty work.** On a win the tier's purse goes to everyone
   aboard through the ledger: two base shares for the captain, one for each other pirate, each
   scaled between half and full by that pirate's duty points during the fight against the best
   aboard. The remainder of the integer split goes to the captain.
6. **Rated against thresholds for now.** DESIGN.md 3.6 rates Sea Battle head to head; with no
   human opponent until there is player-versus-player at sea, a fight is rated like a duty puzzle,
   by score against content thresholds, in practice and aboard alike. Head-to-head rating comes
   with the opponent.

## Consequences

- `PUZZLE_IDS` gains `battle`, and the engine, protocol and content now distinguish the duty
  puzzles (`DUTY_PUZZLE_IDS`, `StationSchema`) from every puzzle. A station is never the battle.
- The brigand's search is bounded: at most every ordering of a four-token pool, each sailed once
  against two guesses of the captain's plot. It runs in well under a frame on a phone.
- The ship reducer grew `engage`, `hit`, `fired` and `battle_end`, and holds position while a
  fight is on; the voyage row records the fight's outcome and purse in its encounter.
- The battle board is landscape (DESIGN.md 3.5): a grid beside a plot strip on a wide screen,
  above it on a phone. It draws its own hulls, loads and turn clock so the same board reads the
  same in the harness and over the deck.
- Boarding is stubbed: a grapple that lands ends the fight at once. M5's Swordfighting opens
  where the stub resolves.
