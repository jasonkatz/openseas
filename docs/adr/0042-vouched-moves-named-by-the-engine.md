# 0042. Each engine names the moves the server vouches for, and one queue on a board holds them

Status: Accepted. Builds on [0015](./0015-puzzle-registry.md),
[0022](./0022-swordfight-melee-routed-by-the-server.md),
[0024](./0024-ship-boards-handed-back-after-a-missing-move.md) and
[0029](./0029-harness-bilging-plays-a-lone-ships-bilge.md).

## Context

Some moves in a pirate's log are not the pirate's. The ship puts them there and the server vouches for
them (ADR 0022): the ship's heat on a Cooling board (ADR 0029), the ship's supply on the battle board
(ADR 0021), the scrap a melee sends a board (ADR 0022), and a melee board's win, which the server writes
into the log itself. The client logs the first three when the server says them, and the server accepts
each only as it said it.

Each had grown its own wiring. A puzzle session carried three fields (`shipHeatRow`, `shipSupply`,
`meleeIncoming`), the ship service and the harness's lone ship wrote them, the session manager checked
each with its own type guard and comparison and cleared two of them its own way, and the hand-back
(ADR 0024) replayed two of them, each by hand. The guards read engine move shapes out of `unknown`,
outside the registry, so ADR 0015's promise that a new puzzle leaves the server unchanged did not hold
for a puzzle with a vouched move.

The three also differ in a way the fields only implied. The heat is a reading: the latest depth stands,
and a board may log it again. The supply is a turn's deal: the latest replaces one not yet logged, and
it is logged once. The scrap is a stream: each batch is logged once, in the order sent.

## Decision

1. **The engine names its vouched moves.** `PuzzleDef` gains an optional `vouched(move)`, which returns
   the kind of vouched move a move is, or null for one of the player's own. A kind has a name, a rule
   and, unless the server writes it itself, `same(said, move)`: whether the board's move says what the
   server said. Fields the board fills in itself, such as the tick scrap lands at, are not compared.
   The rules are `standing` (the heat), `latest` (the supply), `queue` (the scrap) and `server` (a
   melee board's win, which a board never logs). Cooling, Space Battle and Swordfighting fill it in;
   the engine stays pure, since it is a plain function over the engine's own move type.
2. **One queue on each board holds what the server said.** A session has one `VouchedMoves`, built from
   its engine's definition. `vouch(move)` records a move the board may log and says whether it is news
   (a standing word the board already has is not); `pending()` is everything the board may still log,
   in the order said; the session manager asks `admits(move)` before it replays a move, and tells it
   `logged(move)` after. Its check takes the place of the four guards, in the same place, with the same
   `illegal_move`.
3. **The puzzle service says it on the wire, once.** `PuzzleService.vouch(session, move)` records the
   move and returns the message that tells the board (`duty.heat`, `battle.supply`, `melee.incoming`), or
   null when it is no news. `PuzzleService.handBack(session)` is the resumed deal followed by a message
   for every pending vouched move. The ship service calls these. The harness's lone ship vouches for its
   heat in the session manager, which has no wire, and the puzzle service sends what moved. Nothing else
   builds the messages.

## Consequences

- A puzzle with a new vouched move declares it in its registry entry and the session manager checks it
  unchanged. Only saying it on the wire is server work: a message in the protocol and a line in the
  puzzle service.
- The accept and reject decisions, the reject reason and the wire are unchanged. A board still logs a
  standing heat again, and a latest supply still gives way to the next turn's before it is logged.
- The win over foes outside a melee board is now a kind like the others, with the rule that says the
  server alone writes it, rather than a check of its own.
- The hand-back sends whatever is pending, of any kind, so it needs no change when a puzzle gains one.

## Alternatives considered

- **A table in the server keyed by puzzle id.** It gives the same queue and the same check, but keeps
  engine move shapes outside the engine, read out of `unknown`, beside the registry that already
  carries the server's other per-puzzle checks (`maxMoves`, `moveTimeMs`).
- **Vouching values rather than moves** (`{ scrap, blade }` instead of an `incoming` move). The ship
  and the engine would have to agree on a second shape with nothing to check it; a move is typed by
  the engine both sides already use.
- **One rule for all three.** Making the heat a deal logged once would resend every turn's depth and
  refuse a board that logged it twice; making the supply standing would let a board log one deal twice.
