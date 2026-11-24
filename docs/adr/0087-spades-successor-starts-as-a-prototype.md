# 0087. Spades' successor starts as a prototype: Pact

Status: Accepted. Builds on [0001](./0001-spiritual-successor.md), [0036](./0036-prototype-puzzles.md)
and [0078](./0078-treasure-hauls-successor-starts-as-a-prototype.md).

## Context

DESIGN.md section 3 lists parlor games as explicitly later. The original's Spades is one of them:
partnership trick-taking for four, each player bidding the tricks they will take, spades always
trumps. The owner asked for a successor to it now, built the way Tractor was (ADR 0078).

Spades is a game for four people in two partnerships, and a game of hidden cards. Every prototype so
far is a round one player plays alone and is rated on by its thresholds. Swordfighting's raiders are
the precedent for opponents that live inside the engine; Scanner is the precedent for a prototype
whose state holds what the player must not see. Poker's successor, built beside this one, plays
rivals in the engine the same way, and the owner's notes on it (traditional suits, a pace slow
enough to follow the other seats, no score that goes below zero in a way that confuses) shaped this
one.

## Decision

1. **It is built as a prototype.** Pact (`pact`) is an entry in `PROTOTYPE_PUZZLE_IDS`, with every
   file ADR 0036 lists. It is dealt only in the studio and has no role. Nothing in the game links to
   it until it is promoted, which stays its own ADR and milestone.
2. **It is a successor, and says so.** Its design file names Spades as what it follows, keeps the
   mechanics of partnership Spades (four seats, partners across, thirteen cards each, a bid of
   tricks or nil, the partnership's pact as the sum of its bids, follow suit, spades always trumps
   and not led until broken, ten a trick bid and one a bag, nil for a hundred, a penalty for every
   ten bags), and gives its own words, art, sounds and numbers.
3. **The other three seats are played by the engine.** One rule plays the partner and both
   opponents. It sees only what its seat could: its own cards, the bids, the cards played and the
   tricks taken. It draws nothing at random. A seat's bid or card is a move in the log (`next`),
   which the board sends at its own pace (about a second a card, and a finished trick held on the
   table before it is gathered), so a round replays from its log and the server verifies it like
   any other.
4. **A hand never scores below zero.** Each side's count for a hand (its pact made or missed, its
   nils, its bags and their penalty) is added to its total, or nothing is when it comes to less.
   The round's score is the player's side's total, so it only climbs. Falling short still costs: the
   hand scores nothing, and the rivals take a set bonus.
5. **Setting the rivals pays.** A side whose rivals fall short of their pact scores `setBonus` for
   each trick of that pact. In Spades a set is worth what it costs the rivals in a race to a target;
   a round here is not a race, so the set is paid to the side that made it.
6. **A sitting is four hands.** Long enough to see the bids and the bags matter, short enough to sit
   through (about seven minutes at a person's pace). The original plays to a target score.
7. **The hidden cards stay on the client for now.** The deck and the other seats' cards are in the
   state the client holds, as Scanner's contacts are. A round that counted for anything would need
   the server to deal and answer; that is decided with the promotion.
8. **Spades stays on the later list as a parlor game.** Four people at one table, with a wager, is
   decided with the parlors, with the promotion.

## Consequences

- The prototype count grows by one. Documents that count the prototypes (CLAUDE.md, DESIGN.md 3.12,
  the prototypes README, the glossary) count Pact apart as a successor beside Tractor.
- Its departures (seats in the engine, a hand floored at zero, the set paid to the setters, a
  sitting of four hands) are a row in DESIGN.md section 6.
- Its thresholds are set from bots until people have played it. A sitting is short against the luck
  of the deal, and the design file says so. It has no ladder yet; nil, bags and the set bonus each
  have an off value, which is what a stage would switch.
