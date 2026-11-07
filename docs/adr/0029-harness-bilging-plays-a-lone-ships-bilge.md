# 0029. The harness plays Bilging against a lone ship's bilge, and a bilge never reads dry

Status: Accepted. Builds on [0003](./0003-pure-engine-replay-verification.md),
[0015](./0015-puzzle-registry.md), [0027](./0027-voyage-bench-sails-the-engines-as-the-server-does.md)
and [0028](./0028-standing-is-earned-in-the-game.md).

## Context

The owner's review of what each puzzle rewards settled two things that meet in Bilging. Duty puzzles
are scored per second, and a round should score the same in the harness as aboard.

Bilging's practice water did not match the ship's. On the practice page every swap raised the water
a sixth of a row and every 40 points drained one. Aboard, the board's water is the ship's bilge,
which rises with each 10-second turn and drains with the pump station's output. Under per-second
scoring, a fast player on the practice page flooded faster (more swaps a second) and their underwater
swaps slowed them down, while aboard, speed raises nothing. Harness rounds would have scored fast
play lower than the ship does, and tuning against them would mislead.

Building a ship for the harness turned up a second problem. A sloop with a sound hull and anyone at
the pump, even a deckhand, stays dry, and the board read a dry bilge as row 0. Nothing was ever
underwater, and every barnacle came off the moment it appeared. Barnacles lifted together are meant
to be Bilging's biggest boost, but on a calm voyage they could never be set up.

## Decision

1. **Every Bilging board the server deals plays on ship water.** Content sets `shipWater`. Swaps
   neither raise nor drain the water; water events in the log do.
2. **A bilge never reads dry.** `bilgeRowsFor` reads permille of a full bilge as rows of the board,
   never below the board's `minWaterRow` (three rows in content). This holds aboard and in the
   harness: a sound, pumped ship's board keeps its bottom three rows underwater.
3. **A lone ship for a board played on its own.** `soloBilgeStart` and `soloBilgeTurn` in
   `engine/src/ship/aboard.ts` model a sound sloop with nobody else aboard. Each turn of the class's
   `turnSeconds`, its bilge takes the class's intake and drains by this board's own output against
   Bilging's par, through `bilgeAfterTurn`, the same function the ship's turn uses. It is pure and
   has no rules of its own.
4. **Pushed as a ship pushes its bilge.** For a recorded round, the server's session manager turns the
   lone ship on its once-a-second tick and sends `duty.water` whenever the depth changes. It accepts
   a water move only at the depth it last sent, as it does for a duty board. For unrated and lab
   rounds the harness turns the same ship on the round's own clock, so a paused or slowed lab clock
   holds the water too.
5. **The board's own water stays in the engine.** A lab round can turn `shipWater` off to play it, and
   the "fast water" preset does.

## Consequences

- A Bilging score in the harness now measures what it would be worth aboard a sound ship.
- Aboard, crews see three rows of water on a dry ship where they saw none. Underwater swaps and
  barnacle setups are part of every board.
- A depth reaches a recorded round's client up to a second after its turn, since the server ticks
  once a second. The client logs whatever it is told, so the log stays the whole story.
- The lone ship never takes damage and has no carpenter. A lab setting for a leaking hull would be a
  later addition. Until then, the "high water" preset raises the board's floor instead.
- Once per-station output caps arrive, the lone ship takes Bilging's cap as the ship does, through
  the same rules.
