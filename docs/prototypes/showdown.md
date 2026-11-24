# Showdown

Status: built. Prototype (ADR 0036, ADR 0082), in the studio at `/showdown`. A knockout against three
rivals from 10 chips each, bounded by 40 hands and a 1200 second clock.

Showdown is a successor, not one of the game's own new designs: it follows the original's Poker,
the parlor game of hold'em at a card table (DESIGN.md section 3 lists parlor games as explicitly
later). It keeps that game's mechanics, plays them at a fixed limit against rivals in the engine,
and gives everything a player sees and hears its own form. Where it departs from the original is
listed in DESIGN.md section 6.

## The puzzle

The crew plays cards in the mess between jobs. The player sits down at a table of four, themselves
and three rivals (`rivals`), and everyone buys in for the same small stack, 10 chips (`stack`). The
game runs until one player holds them all.

- **A hand.** Every seat still in is dealt two cards face down. Five cards turn face up in the
  middle, three (the flop), then one (the turn), then one (the river). A seat's hand is the best five
  of its two and the five. Hands rank as they always have: a straight flush, four of a kind, a full
  house, a flush, a straight, three of a kind, two pairs, a pair, high card. The ace plays high or,
  in a five-high straight, low.
- **The blinds and the button.** The button moves one seat round each hand, past seats that are
  out. The two seats after it post the small blind (1) and the big blind (1). Heads up, the button
  posts the small blind.
- **The verb is a decision.** Seats act in turn. Each folds, calls what has been bet (a check when
  there is nothing), or raises by one bet (a bet when nothing has been). Bets are fixed: 1 before
  the flop and on it (`smallBet`), 2 on the turn and river (`bigBet`). A street takes at most four
  bets (`raiseCap`), the big blind counted. Before the flop the seat after the big blind acts first;
  after it, the first seat after the button still in.
- **All in.** A seat that cannot cover a call or a raise puts in all it has. It acts no more that
  hand, and it can win from each seat only what it put in itself; the rest is a side pot among the
  seats that put in more. A raise all in short of a full bet moves the price but does not count
  toward the cap. When no more than one seat can still bet, the cards left turn one street at a
  time with no betting.
- **The pot.** A street ends when everyone still able to bet has acted and put in the same. The last
  seat in takes the pot. After the river's betting, the seats still in show and the best hand takes
  each pot it is in; equal hands share it, an odd chip to the first of them after the button.
- **Out.** A seat with no chips after a hand is out. The player loses when they are out, and wins
  when every rival is.
- **The rivals.** Each is dealt a style at the start of the game from `styles`, one a seat, and
  plays it all game; its seat shows the style's emblem and name. Every style plays by one rule:
  it reckons its share of the pot by dealing out the cards it cannot see 120 times (`samples`),
  from its own seeded stream, and compares that share, as a part of a fair share (its share times
  the seats still in), with the price of a call. It raises from `raiseAt`; it calls while it is no
  more than `slack` short of the price; with nothing to call it bets `bluff` times in a thousand on
  less than a fair share. A rival sees only its own cards, the cards turned and the betting.
  - **Brick**: folds without good cards, rarely raises, never bluffs (slack -900, raise from 1900).
  - **Sponge**: calls nearly anything and seldom raises (slack 200, raise from 2200, bluff 20).
  - **Hothead**: raises with too little and bluffs a third of the time it is checked to (slack -100,
    raise from 1100, bluff 350).
  - **Shark**: plays its cards against the price (slack -500, raise from 1400, bluff 120).
- **The score** is 100 points (`knockout`) for each rival out, and for a win 2 points (`speed`) for
  each hand under 40 (`hands`) it took. If 40 hands pass with seats still in, every rival holding
  fewer chips than the player counts as beaten. A round left early keeps only the rivals already
  out. The score only grows: leaving is never worth it, and nobody goes below nothing.

The compound move the puzzle pays most for: **the check-raise**, a strong hand checked to a rival
who will bet, then raised once the others have called, best on the turn where bets are double. A
check-raise that takes the pot is called out and gets the beat.

## Luck and skill

- **Luck:** the cards, and the rivals' bluffs. Ten chips is a short stack: one bad beat can put a
  player out. See the open questions.
- **First skill:** folding. Most hands lose; folding them before the flop costs at most a blind,
  and with a short stack every chip kept is time at the table. The careless bot is out first most
  games.
- **Second skill:** the price. Bet good hands instead of checking them, and call only when the pot
  pays for the chance: the HUD shows the pot and what a call costs.
- **Third skill:** reading the table. Each rival's style is shown and never changes: never bluff a
  sponge and bet it thinner, bluff a brick, call a hothead down lighter.
- **Fourth skill:** the trap. Check a strong hand to a hothead, let it bet and the others call, then
  raise; better on the turn.
- **Fifth skill:** stacks. Who is short and who can put you out: press a short stack that must
  call, and fold a decent hand to a big one's raise when losing it would put you out.

## The ladder

Not yet laddered (ADR 0066). The obvious first stage is a table of one style (a sponge table teaches
value betting, a brick table teaches stealing), and the rivals' styles are the layer a stage would
switch: `styles` is a config key. It waits on the owner's view of the luck below, which would change
what a stage is.

## Input and feedback

- Pointer: three buttons under the player's cards, left to right Fold, Call (Check when nothing is
  owed) and Raise (Bet when nothing has been bet, Capped when the street is). Each says what it
  costs. Between hands one wide button deals the next.
- Keyboard: F, C and R, or 1, 2 and 3, press the buttons; space or enter deals.
- The rivals act on the board's own pace: 1400 ms after the table has settled (half that once the
  player has folded), the board asks the engine for the next rival's action, or, with nobody left
  to bet, the next cards. The engine never moves on its own (`next` is a move in the log, one rival
  or one street a move), so a round replays exactly.
- Unrated and lab rounds frame the move a shark would make after six seconds idle (`showdownHint`),
  and the deal button between hands.

The board follows the brand book (`docs/BRAND.md`, ADR 0061, ADR 0062): it draws its pieces in code
(`boards/src/showdown/pieces.ts`) from `boards/data/pieces/showdown.json`, and loads no image.

- **A card** is a raised tile with a hairline, its rank in cream mono over its suit's pictogram.
  Face down, it shows the back's slate seal.
- **The suits** are the traditional four, each its own outline: spades and clubs cream, hearts and
  diamonds rose.
- **The rivals' emblems**: a brick with its mortar line (slate), a sponge with its hole (moss), a
  flame (rust), a fin (teal).
- **A chip** is a cream disc with its inlay cut out; **the button** a cream puck with a slot. Each
  seat shows its chips under its name; a seat that is out says so and is dealt nothing.
- **The table.** Bare ground, no felt and no frame. The one hairline is the edge of the player's own
  seat. The seat to act wears an amber ring; amber is the active thing.
- **Feedback.** Each action is said under its seat ("Raises 2", "All in 3") and its chips slide in, with a tick
  for a call, a rising pop for a raise, a bump for a check and a whoosh for a fold. Cards turn with
  a soft flick. At a showdown the shown hands are named and the five cards that won stay lit while
  the rest dim; the winner's chips rise over its seat, amber for the player.
- **Callouts**, one a hand: the check-raise, else a knockout ("Brick is out", "You're out"), else
  who took the pot or a split.
- **The beat** is kept for one thing: a check-raise that takes the pot.

## Engine

`packages/engine/src/showdown/`. Moves: `fold`, `call`, `raise`, `next`, `deal` and `end`. A move's
report holds its events: a deal (the button, the blinds and the player's cards), each seat's action
with what it put in and whether that put it all in, cards turned, and the hand's end (the pot, the
winners, what each was paid with side pots summed, the hands shown, whether it was a check-raise and
the seats it put out). `cards.ts` holds the hand evaluator and the rivals'
reckoning, in integers throughout.

## Tuning notes

Set from bots, not people (ADR 0036). A person's pace is modelled as 3 seconds a decision, the
board's 1.4 seconds a rival's turn and 2.5 seconds to look at a hand's end: a game is about six
minutes.

- **A knockout, not a sitting.** The first pass scored a sitting of 12 hands on a bank of 100 and the
  net, and a player could lose without end. The owner wanted a table with an end: everyone starts
  even, the player is out at zero and wins when everyone else is.
- **Ten chips, small bets.** The stack is the owner's number. With blinds of 1 and 2 and bets of 2
  and 4, ten chips is five big blinds and the game is mostly all ins: careless play won the table 18
  percent of the time, and raising every hand 22, more than the shark. With blinds of 1 and 1 and
  bets of 1 and 2, ten chips is ten bets and folding means something again. Twenty chips at the
  small bets makes rounds of ten minutes and more and leaves the brick-like play hanging on to the
  hand cap.
- **The score.** A rival out is the unit. A win adds a little for each hand under the cap, which is
  what lifts a win into Legendary; it pays a gambler's quick wins too, so it is kept small.
- **Forty hands** is a cap, not a length: most games end long before it. It keeps a table of bricks
  from running all evening.
- **The styles' numbers** are the first pass's (set so each reads as its name in play) and were not
  retuned for short stacks.
- **Thresholds** read a place: out first is Green, outlasting one rival Steady, two Sharp, winning
  the table Masterful, and winning it within 20 hands Legendary.

The bots of this pass, 200 seeds (`pnpm --filter @openseas/bots ladder showdown --seeds 200`):

| Bot | Full (1200 s) |
|---|---|
| careless | 98 Green |
| shark | 194 Steady |
| reader | 191 Steady |
| rock | 153 Steady |
| caller | 78 Green |
| raiser | 107 Steady |
| *Steady from* | *100* |
| *Sharp from* | *200* |
| *Masterful from* | *300* |
| *Legendary from* | *340* |

- **careless**: any choice at random.
- **shark**: the shark's numbers at the player's seat.
- **reader**: the shark's numbers moved for the rivals still in: never bluffs a sponge and raises
  it from 1150, bluffs a table of bricks 600 times in a thousand, calls 300 lighter into a hothead.
- **rock**: the brick's numbers.
- **caller** (a bait): calls or checks every time.
- **raiser** (a bait): raises whenever the street takes one.

Checks: careless lands a tier below the shark; the caller loses to the shark by 60 percent, the
raiser by 45; the rock loses to the reader by 20.

How the games went, 200 seeds each (wins, outs, games that reached the cap, hands a game):

| Bot | Won | Out | Capped | Hands |
|---|---|---|---|---|
| careless | 7% | 86% | 8% | 14 |
| shark | 16% | 57% | 28% | 24 |
| reader | 30% | 49% | 22% | 21 |
| rock | 0% | 51% | 50% | 33 |
| caller | 3% | 82% | 16% | 13 |
| raiser | 19% | 80% | 1% | 9 |

Open questions for play:

- **Luck within a game.** Ten chips is short. The reader wins the table about one game in three and
  is out first or second in half; the raiser wins one in five, quickly, and is out early in the rest.
  The means are in the right order and far apart; one game is not. Rule 7 (luck deals, skill
  decides) holds over an evening, not a round. Ways to narrow it: a deeper stack, or a game scored
  over several tables. The owner's call.
- **The blinds.** A small blind equal to the big one is unusual; it keeps the bets whole numbers at
  ten chips. A small blind of 0 is the other way.
- **The pace.** 1400 ms a rival's turn is the second guess (the first, 750, was too fast); the rest
  of a hand the player folded out of plays at half that.
- **No ladder yet**, as above.
- **Hidden cards.** The rivals' cards and the deck are in the state, which the client holds: a
  round that counted for anything would need the server to deal, as Scanner would (ADR 0036).
