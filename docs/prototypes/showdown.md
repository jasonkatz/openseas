# Showdown

Status: built. Prototype (ADR 0036, ADR 0082), in the studio at `/showdown`. A sitting of 12 hands
against three rivals, bounded by a 600 second clock.

Showdown is a successor, not one of the game's own new designs: it follows the original's Poker,
the parlor game of hold'em at a card table (DESIGN.md section 3 lists parlor games as explicitly
later). It keeps that game's mechanics, plays them at a fixed limit against rivals in the engine,
and gives everything a player sees and hears its own form. Where it departs from the original is
listed in DESIGN.md section 6.

## The puzzle

The crew plays cards in the mess between jobs. The player sits down with a bank of 100 chips
(`bank`) at a table of four: themselves and three rivals (`rivals`). A sitting is 12 hands
(`hands`), and the score is what the player stands up with.

- **A hand.** Every seat is dealt two cards face down. Five cards turn face up in the middle, three
  (the flop), then one (the turn), then one (the river). A seat's hand is the best five of its two
  and the five. Hands rank as they always have: a straight flush, four of a kind, a full house, a
  flush, a straight, three of a kind, two pairs, a pair, high card. The ace plays high or, in a
  five-high straight, low.
- **The blinds and the button.** The button moves one seat round each hand. The two seats after it
  post the small blind (1) and the big blind (2). Heads up, the button posts the small blind.
- **The verb is a decision.** Seats act in turn. Each folds, calls what has been bet (a check when
  there is nothing), or raises by one bet (a bet when nothing has been). Bets are fixed: 2 before
  the flop and on it (`smallBet`), 4 on the turn and river (`bigBet`). A street takes at most four
  bets (`raiseCap`), the big blind counted. Before the flop the seat after the big blind acts first;
  after it, the first seat after the button still in.
- **The pot.** A street ends when everyone still in has acted and put in the same. The last seat in
  takes the pot. After the river's betting, the seats still in show and the best hand takes the pot;
  equal hands share it, an odd chip to the first of them after the button.
- **No stacks.** Nobody runs out of chips: any seat can always call, so nobody is ever all in and
  there is never a side pot. A player who loses their whole bank plays on, at a score of zero.
- **The rivals.** Each is dealt a style at the start of the sitting from `styles`, one a seat, and
  plays it all sitting; its seat shows the style's emblem and name. Every style plays by one rule:
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
- **The score** is the player's bank and net, never below zero. A sitting left before its last hand
  keeps none of its winnings, and only its share of the bank for the hands played out
  (`bank * done / hands`): stopping while ahead is never worth it, and a sitting never played scores
  nothing.

The compound move the puzzle pays most for: **the check-raise**, a strong hand checked to a rival
who will bet, then raised once the others have called, best on the turn where bets are double. A
check-raise that takes the pot is called out and gets the beat.

## Luck and skill

- **Luck:** the cards, and the rivals' bluffs. Twelve hands is a short sample: the same play can
  stand up with 60 or with 160. See the open questions.
- **First skill:** folding. Most hands lose; folding them before the flop costs at most a blind.
  The careless bot's losses are mostly calls it should not have made.
- **Second skill:** the price. Bet good hands instead of checking them, and call only when the pot
  pays for the chance: the HUD shows the pot and what a call costs.
- **Third skill:** reading the table. Each rival's style is shown and never changes: never bluff a
  sponge and bet it thinner, bluff a brick, call a hothead down lighter.
- **Fourth skill:** the trap. Check a strong hand to a hothead, let it bet and the others call, then
  raise; better on the turn.
- **Fifth skill:** knowing when the price is wrong for everyone: folding a decent hand to a brick's
  raise, which it never makes without good cards.

## The ladder

Not yet laddered (ADR 0066). The obvious first stage is a table of one style (a sponge table teaches
value betting, a brick table teaches stealing), and the rivals' styles are the layer a stage would
switch: `styles` is a config key. It waits on the owner's view of the sitting's length and luck
below, which would change what a stage is.

## Input and feedback

- Pointer: three buttons under the player's cards, left to right Fold, Call (Check when nothing is
  owed) and Raise (Bet when nothing has been bet, Capped when the street is). Each says what it
  costs. Between hands one wide button deals the next.
- Keyboard: F, C and R, or 1, 2 and 3, press the buttons; space or enter deals.
- The rivals act on the board's own pace: 750 ms after the table has settled (a third of that once
  the player has folded), the board asks the engine for the next rival's action. The engine never
  moves on its own (`next` is a move in the log), so a round replays exactly.
- Unrated and lab rounds frame the move a shark would make after six seconds idle (`showdownHint`),
  and the deal button between hands.

The board follows the brand book (`docs/BRAND.md`, ADR 0061, ADR 0062): it draws its pieces in code
(`boards/src/showdown/pieces.ts`) from `boards/data/pieces/showdown.json`, and loads no image.

- **A card** is a raised tile with a hairline, its rank in cream mono over its suit's pictogram.
  Face down, it shows the back's slate seal.
- **The suits** each have an outline of their own: a four-pointed star (sand), a crescent moon
  (sky), a planet crossed by its ring (lilac), a comet's head and tail (rose).
- **The rivals' emblems**: a brick with its mortar line (slate), a sponge with its hole (moss), a
  flame (rust), a fin (teal).
- **A chip** is a cream disc with its inlay cut out; **the button** a cream puck with a slot.
- **The table.** Bare ground, no felt and no frame. The one hairline is the edge of the player's own
  seat. The seat to act wears an amber ring; amber is the active thing.
- **Feedback.** Each action is said under its seat ("Raises 4") and its chips slide in, with a tick
  for a call, a rising pop for a raise, a bump for a check and a whoosh for a fold. Cards turn with
  a soft flick. At a showdown the shown hands are named and the five cards that won stay lit while
  the rest dim; the winner's chips rise over its seat, amber for the player.
- **Callouts**, one a hand: who took the pot, a split, or the check-raise.
- **The beat** is kept for one thing: a check-raise that takes the pot.

## Engine

`packages/engine/src/showdown/`. Moves: `fold`, `call`, `raise`, `next`, `deal` and `end`. A move's
report holds its events: a deal (the button, the blinds and the player's cards), each seat's action
with what it put in, cards turned, and the hand's end (the pot, the winners, what each was paid, the
hands shown and whether it was a check-raise). `cards.ts` holds the hand evaluator and the rivals'
reckoning, in integers throughout.

## Tuning notes

Set from bots, not people (ADR 0036). A person's pace is modelled as 3 seconds a decision, the
board's 0.75 seconds a rival's turn and 2 seconds to look at a hand's end: a sitting is about four
minutes.

- **The score is the bank, not the net.** A score of the net floored at zero paid gambling: the
  raiser's wild swings averaged above the shark's steady wins. With the bank, a loss costs as much
  as a win pays.
- **Fixed limit.** One verb with three choices, and every bet is a number on its button. No-limit
  wants a slider and an all-in, and a stack to bet; it is the original's, and it waits for people at
  the table.
- **Twelve hands.** Long enough for every rival to be seen in a few pots, short enough to sit through.
- **The styles' numbers** were set so each reads as its name in play: over 48 sittings against a
  shark at the player's seat, a brick folded 63 percent of its actions and raised 2, a sponge folded
  15 and raised 2, a hothead folded 14 and raised 50, a shark folded 39 and raised 20, and about
  half the hands reached a showdown.
- **Thresholds** sit so that careless play and the two baits are Green, the shark and the rock are
  Steady, and the reader, who plays each rival its own way, is Sharp. Masterful and Legendary are
  left for play no bot here reaches.

The bots of this pass, 200 seeds (`pnpm --filter @openseas/bots ladder showdown --seeds 200`):

| Bot | Full (600 s) |
|---|---|
| careless | 82 Green |
| shark | 109 Steady |
| reader | 112 Sharp |
| rock | 98 Steady |
| caller | 80 Green |
| raiser | 67 Green |
| *Steady from* | *92* |
| *Sharp from* | *112* |
| *Masterful from* | *140* |
| *Legendary from* | *175* |

- **careless**: any choice at random.
- **shark**: the shark's numbers at the player's seat.
- **reader**: the shark's numbers moved for the rivals still in: never bluffs a sponge and raises
  it from 1150, bluffs a table of bricks 600 times in a thousand, calls 300 lighter into a hothead.
- **rock**: the brick's numbers.
- **caller** (a bait): calls or checks every time.
- **raiser** (a bait): raises whenever the street takes one.

Checks: careless lands a tier below the shark; the caller loses to the shark by 27 percent, the
raiser by 39; the rock loses to the reader by 13.

Open questions for play:

- **Luck within a sitting.** A sitting's score spreads widely: over 200 sittings each, the reader
  (mean 114) was Green a quarter of the time and Legendary one time in thirteen, and the raiser (mean
  66) was Masterful or Legendary one time in nine. The means are in the right order and far apart;
  one sitting is not. Rule 7 (luck deals, skill decides) holds over an evening, not a round. Ways to
  narrow it: a longer sitting, a table whose rivals leak more, or scoring a pot by each seat's share
  of it when the betting stopped. The owner's call.
- **The pace.** 750 ms a rival's turn is a guess; the rest of a hand the player folded out of plays
  at a third of that.
- **No ladder yet**, as above.
- **Hidden cards.** The rivals' cards and the deck are in the state, which the client holds: a
  round that counted for anything would need the server to deal, as Scanner would (ADR 0036).
