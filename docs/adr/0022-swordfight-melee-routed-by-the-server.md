# 0022. Swordfighting is one board per pirate; the server routes a melee's attacks as vouched moves

Status: Accepted. Builds on [0003](./0003-pure-engine-replay-verification.md),
[0015](./0015-puzzle-registry.md), [0019](./0019-boards-package-and-harness-bench.md) and
[0021](./0021-sea-battle-as-the-captains-board.md).

## Context

M5 brings the boarding fight (DESIGN.md 3.3): every pirate aboard against the brigand crew, each on
a falling-block board, attacks crossing between boards in real time, with a practice page in the
harness first (ADR 0011). It had to fit the rules in force: a pure engine the server replays
(ADR 0003), one registry driving every engine (ADR 0015), boards that compute no score (ADR 0019),
and a ship the server owns on a turn clock (ADR 0020). Three things were open: how a fight with
several hands in it replays from a log, where the brigand crew's hands live, and how a crew's
boards affect each other when every pirate's moves arrive on their own socket.

A single shared engine state for the whole melee, with the server ordering everyone's moves into
one log, was weighed and set aside: every client would have to reconcile its own drops against a
log it did not control, and a board could not be verified on its own.

## Decision

1. **The fight is a puzzle in the registry, `swordfight`, with time in its moves.** A `place`
   carries the column, rotation and tick a pair came to rest at; a `wait` carries a tick. AI
   pirates in the fight act on their own cadence inside the reducer, chosen from the fight's PRNG,
   so a practice fight against brigands, with allies or not, replays exactly from one log. Waiting
   wrack lands on a timer in the same way, so a stalled hand never dodges an attack.
2. **One board per pirate; a melee is a set of fights the server joins up.** Aboard, each pirate's
   board is its own fight whose foes are outside it (`foes` empty): what it breaks leaves as an
   `attack` event the server reads from the move report, and what it is sent arrives as an
   `incoming` move that must repeat what the server announced (`melee.incoming`), in order, the
   way a Bilging board aboard logs the bilge. The brigand crew is one more fight the server runs
   itself, with no player in it (`player` false) and one AI board per pirate at the rail, from the
   tier's `swordsmen`; the server advances it on its own clock and routes its attacks to the
   pirate with the least on their board. Every pirate's log stays verifiable on its own, and the
   server is the only authority on who sent what to whom.
3. **The end is the server's word.** A board that fills is out and its fight ends `lost` by the
   engine's own rules. A fight whose foes are outside it cannot see them beaten, so the server
   announces it (`melee.over`) and the board logs an `end` move saying so, which the engine takes
   only when the foes are outside; in practice a win is the engine's. The melee is won when every
   brigand board is out and lost when every pirate's is; the booty then goes out through the sea
   battle's own split (ADR 0021), to everyone who fought.
4. **Everyone sees every board.** The server sends the melee's boards (`melee.boards`) to the crew
   whenever one changes: a string per board, a name, the wrack waiting on it, whether it is out.
   The board renderer draws them beside the pirate's own; in practice the same renderer draws
   the fight's own AI boards from the state. Presentation only: nothing in it is scored.
5. **Tiers are content.** A brigand tier's `swordsmen` is how often they drop, how often they
   pick the best drop, and their blade; the board's rules, blades and the practice brigand are
   `puzzles/swordfight.json`.
6. **Rated against thresholds for now**, like Sea Battle (ADR 0021): a fight is scored by points
   and the win, and rated like a duty puzzle until there are duels between pirates.

## Consequences

- `PUZZLE_IDS` gains `swordfight`. The protocol gains the fight's moves and config, the melee's
  three server messages and a `melee.join` for a pirate who comes aboard, or back, mid-fight.
- A sea battle that ends in a boarding, either way, no longer pays out at once: it opens the
  melee, which decides the booty. The ship holds position until the melee ends.
- The AI's search is bounded: every column and rotation for the pair in hand, played out once.
  It runs in well under a frame on a phone, and a server fight of a few brigand boards costs a
  few such searches a second.
- Head-to-head play between pirates needs only a second human fight joined by the same routing;
  matchmaking and the tavern table are the open questions, not the engine.
