# 0024. A ship's board is handed back after a missing move, not thrown out

Status: Accepted. Builds on [0003](./0003-pure-engine-replay-verification.md),
[0021](./0021-sea-battle-as-the-captains-board.md) and
[0022](./0022-swordfight-melee-routed-by-the-server.md).

## Context

The client numbers every move it logs; the server applies a move only when its number is the
next one in the session's log and threw the round out (`bad_sequence`) on the first that was not.
That treats a lost move as a lie, and it is almost never one: the server itself drops messages
without applying them (the rate limiter, a message that fails the protocol, an error while
handling it) and answers with an error the client ignores, so one dropped move makes every later
one "out of order".

In production a melee board was thrown out 15 seconds into a fight with a steady move stream on
both sides of the gap: one move never reached the log, the next was refused, and because the
pirate was the only one at the rail the melee and the sea battle were lost with it. None of the
silent drops logged anything, so the cause could not be traced.

A melee board and the captain's sea battle can already be rebuilt: on reconnect the server sends
the deal again with every move it logged (`puzzle.started` with `resume`), plus the wrack or the
supply it announced that the board has not logged yet, and the client replays them from the seed.

## Decision

1. **A missing move on a ship's board gets the board handed back.** When a melee or sea battle
   move arrives with the wrong number, the server keeps the session open and sends the same
   resumed deal a reconnect gets. The client rebuilds the board from the server's log and plays
   on. The server stays the only authority (ADR 0003): it never applies a move it did not receive
   in order, and every move the rebuilt board sends is replayed and hash-checked as before. What
   the player loses is the missing move itself.
2. **Moves still in flight from the old board are dropped until the new one speaks.** After a
   hand-back the session drops, without another hand-back, any move whose number is wrong, and any
   finish whose hash does not match the server's state. The first move at the right number ends
   that. A hand-back costs one round trip, so the old board's few moves in flight are all it
   catches.
3. **A few hand-backs, then the round is thrown out.** After three hand-backs on one board, the
   next missing move rejects the round with `bad_sequence` as before, so a client that keeps
   numbering wrong cannot hold a session open forever.
4. **Every other round still rejects.** Practice and duty boards are short and their clients do
   not rebuild from a resumed deal; a missing move there still ends the round.
5. **The client drops a board handed back to it without a word.** A `puzzle.started` for the
   session the client is already playing replaces the round without sending `puzzle.abandon`,
   which would end the very board the server just handed back.
6. **Every dropped message is logged.** A rate-limited message, one that is not JSON or fails the
   protocol, and a hand-back are each logged with the pirate, and a rejected move's log line says
   the number it carried and the number the server expected.

## Consequences

- A lost move costs a melee board one move and a brief redraw instead of the fight, and the next
  occurrence leaves enough in the logs to find the cause.
- A misbehaving client can trigger at most three hand-backs per board; each one only resends
  state the server already holds.
- Rebuilding needs the client to handle a resumed deal, which is why only the ship's boards that
  already do get the hand-back. Bringing duty boards in later means teaching their client to
  replay first.
