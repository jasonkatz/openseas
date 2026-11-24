# 0082. Poker's successor starts as a prototype: Showdown

Status: Accepted. Builds on [0001](./0001-spiritual-successor.md), [0036](./0036-prototype-puzzles.md)
and [0078](./0078-treasure-hauls-successor-starts-as-a-prototype.md).

## Context

DESIGN.md section 3 lists parlor games as explicitly later. The original's Poker is the best known
of them: hold'em at a card table, played between people for coins. The owner asked for a successor
to it now, built the way Tractor was (ADR 0078).

Poker is a game between people, and a game of hidden cards. Every prototype so far is a round a
player plays alone and is rated on by its thresholds. Swordfighting's raiders are the precedent for
opponents that live inside the engine; Scanner is the precedent for a prototype whose state holds
what the player must not see.

## Decision

1. **It is built as a prototype.** Showdown (`showdown`) is an entry in `PROTOTYPE_PUZZLE_IDS`, with
   every file ADR 0036 lists. It is dealt only in the studio and has no role. Nothing in the game
   links to it until it is promoted, which stays its own ADR and milestone.
2. **It is a successor, and says so.** Its design file names Poker as what it follows, keeps the
   mechanics of hold'em (two cards each, five shared turned three, one and one, the best five of
   seven, blinds and a button, a round of betting before the flop and after each turn, the pot to
   the last seat in or the best hand shown, stacks, all ins and side pots), and gives its own
   words, art, sounds and numbers. Its cards keep the traditional suits, spades, hearts, diamonds
   and clubs: they belong to no game, and a player reads them at a glance.
3. **The opponents are rivals inside the engine.** Each rival is dealt a style and plays by one
   rule with its style's numbers, reckoning its share of the pot from deals of the cards it cannot
   see, on a seeded stream of its own. A rival sees only its own cards, the cards turned and the
   betting. A rival's turn is a move in the log (`next`), which the board sends at its own pace, so
   a round replays from its log and the server verifies it like any other, and no move sets off
   more than about a second of play (ADR 0073).
4. **It plays at a fixed limit, as a knockout.** Three choices, each with its cost on its button.
   Every seat sits down with the same small stack; a seat that cannot cover a bet goes all in, and
   side pots are paid as hold'em pays them. A seat with no chips is out. The player loses when out
   and wins when every rival is.
5. **A round is rated on the rivals the player outlasts.** Points for each rival out, and for a win
   points for each hand under a cap it did not need. After the cap with seats still in, a rival
   holding fewer chips than the player counts as beaten; a round left early keeps only the rivals
   already out. The score never falls as a round goes on, so leaving is never worth it, and a
   player can never go below nothing. (A first pass rated a sitting of twelve hands on a bank of
   chips the player could lose without end; the owner found going negative wrong for the game.)
6. **The hidden cards stay on the client for now.** The deck and the rivals' cards are in the state
   the client holds, as Scanner's contacts are. A Showdown round that counted for anything would need
   the server to deal and answer; that is decided with the promotion.
7. **Poker stays on the later list as a parlor game.** People at one table, with a wager, is decided
   with the parlors, with the promotion.

## Consequences

- The prototype count grows by one. Documents that count the prototypes (CLAUDE.md, DESIGN.md 3.12,
  the prototypes README, the glossary) count Showdown apart as a successor beside Tractor.
- Its departures (a fixed limit, rivals in the engine, a knockout scored on the rivals outlasted)
  are rows in DESIGN.md section 6.
- Its thresholds are set from bots until people have played it. Short stacks are lucky, and the
  design file says how much; it has no ladder yet.
