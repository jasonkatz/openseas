# 0023. Deckhands: AI crew live inside the ship reducer and produce output, not play

Status: Accepted. Builds on [0003](./0003-pure-engine-replay-verification.md),
[0020](./0020-three-js-world-with-boards-over-it.md), [0021](./0021-sea-battle-as-the-captains-board.md) and
[0022](./0022-swordfight-melee-routed-by-the-server.md).

## Context

The game is tuned for crews of three to five (DESIGN.md 3.4), but a tester often sails alone or
with one friend, and an unstaffed sloop crawls with a filling bilge. The original game let a
captain hire AI crew at port. We wanted a ship that sails short-handed to still work as a ship,
without simulating puzzle play for the AI, without a database row per hand, and without breaking
the rules already in force: a pure, replayable ship reducer (ADR 0003), the server as the only
authority (ADR 0020), and a pirate's station always their own choice.

Three places could own the AI: the client (ruled out at once: nothing there is authoritative),
a server-side scheduler that plays moves into the engine, or the engine itself.

## Decision

1. **Deckhands are crew members inside the ship reducer, flagged `mate`.** Setting sail with fewer
   aboard than the class's `minCrew` signs on the difference as `hired` events, each at the first
   open station in the class's `mateStations` (sails, pump, carpentry, guns; never the chart
   table), the rest waiting on deck. Their ids are minted by the engine (`mate:<seq>`), so they
   can never collide with a pirate's, and the engine refuses every pirate move for them: no
   board, no wheel, no leaving, no dropping.
2. **A deckhand's work is a number, not a game.** Each turn a staffed deckhand station's output is
   a roll between `mateOutput.min` and `.max` percent of par from the ship's own PRNG. No duty
   points reach it; the server never deals it a board. Because the roll is the ship's PRNG, the
   same seed and move log replay the same voyage, hands and all, and the hash covers the flag.
3. **The pirate's choice wins; the hand comes back after a rest.** A `station` move onto a
   deckhand's station succeeds where another pirate's would be refused: the hand's station goes
   to null with `idleFromTurn` set `mateRestTurns` ahead. On each turn the reducer seats every
   rested idle hand at the first open station it works, as a `station` event like anyone's. The
   captain may also order a hand to any of the stations it works (`assign`), never the chart table,
   or stand it down; another hand there steps aside and looks again next turn, a pirate there is
   never displaced. A pirate boarding a ship full of deckhands relieves one (the idle one first)
   rather than being turned away.
4. **Hands come and go with the voyage.** They are paid off (`paid_off`) when the ship docks and
   when the last pirate leaves, so a docked ship never has any, and the next sailing signs on fresh
   ones. They earn no booty: the split is among pirates.
5. **The server names them and marks them; the client shows the mark everywhere.** Names come
   from the same lists as pirates' so a hand looks like a character, kept unlike anyone's aboard;
   the snapshot carries `mate: true` and the client draws it as a chip in the crew list, the word
   "deckhand" on their station, and a different peg on deck. The name is never the signal.

## Consequences

- `ShipClassSpec` gains `minCrew` and `mateStations`; `ShipRules` gain `mateOutput` and
  `mateRestTurns`; all are content (`ship-classes.json`, `ocean.json`), validated at startup.
- `CrewMember` gains `mate` and `idleFromTurn`; `ShipEvent` gains `hired` and `paid_off`. The
  server filters deckhands out of everything that is a pirate's: voyage crew rows, island moves,
  the booty split, the notice board's crew count.
- The server now broadcasts the events of every turn it applies (hails, arrivals, deckhands
  moving), which it had been dropping; the ship's log is whole.
- Tuning the hands is a content change. Making them smarter (choosing the pump when the bilge is
  high) would be a reducer change, still deterministic; making them play is out of scope.
