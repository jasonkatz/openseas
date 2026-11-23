# 0075. A puzzle declares its deal: draws on streams of their own, checks that always pass, and secrets

Status: Accepted. Changes the puzzle domain guide's rule that nothing a player could see is hidden.
Builds on [0003](./0003-pure-engine-replay-verification.md) and
[0036](./0036-prototype-puzzles.md)'s note that a puzzle of hidden information counts for nothing until
the server holds the secret.

## Context

The guide said only that the seed fixes the deal. Every engine deals by hand: Salvage rolls kinds and
redeals until a line exists, Gunnery shuffles a bag, Cutting splits a slab weighted by area under a
cap, Scanner redeals until a sector can be solved from its opening ping, Swordfighting reads a stream
shared by every board. The `puzzles` skill holds a puzzle to bounded luck and to never forcing a guess,
yet the puzzle document could not say what is luck at all, so a reader had to open the rules.

Two findings came from reading them. Most engines thread one generator through every draw, so playing
differently changes what a later, unrelated draw gives, and two players on one seed do not meet the same
luck. Scanner keeps its last deal when every try fails its check, so a round can be dealt one that
forces a guess.

The guide also said nothing on the board is hidden. Scanner is built on hidden contacts, and a turn's
orders are hidden from the other side until it resolves. The owner wants such puzzles to be valid.

## Decision

1. **A puzzle declares its draws.** Each says what it gives (a kind, a piece, a place, a map, a task
   or a number), how (an even roll, a weighted roll, a bag or a pick from a list), when (at the start,
   on a refill, for a new task, on a tick or every so many moves) and the settings it reads.
2. **Every draw has a stream of its own,** made from the seed and the draw's id. No draw changes what
   another gives. Between sides, each draw is either one stream every seat reads or one a seat.
3. **A check always ends in a deal that passes.** A check names its draws, its tries and a fallback
   that passes by construction. A deal that would force a guess fails its check. A check may also hold
   during play, with an event that says the board was dealt again.
4. **A bound names the draw it caps.**
5. **A puzzle may declare secrets.** A secret hides a draw or a side's turn orders and comes out only
   on the events the puzzle names. A round with a secret is run by its host, who keeps the seed; a
   player's board gets the round without the secret and plays from events, so a move that can reveal
   one waits on the host. Nothing shown is ever false.
6. **Settings say their units, their list entries, their maps' check and their relations.** A relation
   (at most, below, ascending, fits) is declared beside the settings, and every host holds a round to it
   before it starts, so the studio and the server refuse the same settings. A setting a role may set
   for a round says so.

## Consequences

- The guide gains a section on the deal and the puzzle document a `deal` and `relations`; the glossary
  gains draw, bag, stream, check, fallback, bound, secret and relation. Paths' example declares its deal.
- Engines that thread one generator move to a stream a draw by a change of their own. That changes
  what a seed deals, so it waits for the guide's answer on rule versions, or for a puzzle with no
  stored rounds.
- Scanner's fallback is a bug against the bar and is fixed by a change to Scanner.
- A puzzle with a secret needs its host to deal and answer rounds that reveal, which the studio does
  not do today; Scanner stays a studio-only prototype until it does.
- Relations that live only in each engine's `validateConfig` today move into the puzzle's declaration
  as each puzzle is written out.
