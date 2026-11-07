# 0027. The voyage bench sails a ship through the engine's reducers, wired as the server wires them

Status: Accepted. Builds on [0003](./0003-pure-engine-replay-verification.md),
[0019](./0019-boards-package-and-harness-bench.md), [0021](./0021-sea-battle-as-the-captains-board.md),
[0022](./0022-swordfight-melee-routed-by-the-server.md) and [0023](./0023-deckhands-in-the-ship-reducer.md).

## Context

The harness proves puzzles one at a time (ADR 0019). The owner wants to test the ship and its crew
the same way: a ship class with a crew at their stations, each playing at a chosen level, sailing a
route, and to see how the ship fares out of battle and in it, and how often, across many voyages.

None of that could be set up before. The ship reducer is pure, but a ship only ever sailed inside
the server's ship rooms, and the wiring between the ship and the boards aboard it was server code:
the battle config dealt at a hail, the ship's supply to the captain's board every turn, shots and
hits fed back, the melee opened at a grapple, the purse split. Nothing plotted the captain's side
of a sea battle except a person.

Three ways to get there:

1. **A model in the harness.** Quick, but a second copy of the rules that drifts from the server's
   the first time either changes, and then it tests nothing.
2. **Bots against a real server.** Faithful, but it needs a server and a database, runs on the
   wall clock (a leg is minutes) and is not reproducible.
3. **The engine's own reducers in the browser,** with the wiring the server does moved into the
   engine so both call the same functions.

## Decision

We take the third.

1. **The wiring is engine code.** `engine/src/ship/aboard.ts` holds what the server computed in its
   ship service: the ship's config from a class and the puzzles' par (`shipConfigFor`), a route as a
   leg (`legPlan`), a tier as the battle's brigand (`brigandSpecFor`), the battle config aboard
   (`battleConfigAboard`), the ship's supply to the captain's board (`shipSupply`, `splitTokens`) and
   the booty split (`splitBooty`). Pure and structurally typed, so the engine needs no content
   types. The server now calls these; its behaviour is unchanged.
2. **The simulator is the harness's** (`harness/src/voyage/sim.ts`): pure, deterministic, one step
   per ship turn in the server's order: the script's moves, the melee's ticks, the captain's plot
   committed with its shots and hits fed to the ship, every station's duty points, the ship's turn,
   the board's supply, and the answer to a hail that turn raised. It has no rules of its own:
   every number comes from the reducers.
3. **What is modelled, and says so.** A pirate's board is a number of points per turn, rolled from
   that pirate's own seeded PRNG around a percent of par, with a spread. The captain works no station
   while plotting a fight. The boarding melee is one swordfight with every pirate's hand against the
   tier's crew, where aboard the server routes one fight per pirate (ADR 0022); the page says so.
   The AI captain (`engine/src/battle/captain.ts`) is the brigand's policy sailed from the other
   side of a mirrored state, with its own knobs; the game never uses it.
4. **Held to the server's checks,** as a lab round is (ADR 0019): the edited world must pass content's
   schema and its cross-file checks (now exported as `contentProblems`), and every ship, battle and
   melee config the voyage would deal must pass the engine's validators. A voyage the bench sails is
   one the server could sail.
5. **Proven, and linkable.** Every voyage keeps the ship's move log and each fight's, and the page
   replays them from their seeds and compares every hash. A batch sails derived seeds in a Web
   Worker. The scenario (crew, script, captain, world overrides) is the page's query string.
6. **The tester can take the wheel.** With `wheel=you` the voyage stops at each battle turn and the
   real battle board from `boards` takes the tester's plot; the AI can be asked for any turn.
7. **Pursuit is not invented here.** Evading always succeeds in v1 (DESIGN.md 3.4); the bench sails
   encounters as the reducer rolls them. If pursuit becomes a mechanic it will be a reducer change,
   and the bench will sail it with nothing added.

## Consequences

- The first scenarios found a ship reducer bug: after the captain engaged, the brigand hailed again
  the next turn, mid-fight, and the hail's clock then auto-evaded it. A brigand in a fight now never
  hails again. Fixed with a test in the same change.
- They also show a tuning fact worth knowing: a full crew at par with a navigator already sails a
  sloop at `maxSpeed`, so skill above par buys no speed, only loads, pumping and repairs.
- The engine carries an AI captain the game does not use; its tests (plots always legal, fights
  always end, deterministic) keep it honest because the bench depends on it.
- The server keeps exporting `shipConfigFor`, `legPlan`, `splitTokens` and `splitBooty` for its
  tests; the first is a thin wrapper that reads content.
- The bench measures the ship and its crew, not the puzzles: those are proven on their own pages.
  A change to how the server wires a board aboard belongs in `aboard.ts`, or the bench stops
  telling the truth.
