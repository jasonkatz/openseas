# Pact

Status: built. Prototype (ADR 0036, ADR 0087), in the studio at `/pact`. A sitting of 4 hands with a
partner and against two rivals, bounded by a 600 second clock.

Pact is a successor, not one of the game's own new designs: it follows the original's Spades, the
parlor game of partnership trick-taking (DESIGN.md section 3 lists parlor games as explicitly
later). It keeps that game's mechanics, plays them with a partner and rivals in the engine, and
gives everything a player sees and hears its own form. Where it departs from the original is listed
in DESIGN.md section 6.

## The puzzle

The crew plays cards in the mess between jobs. The player sits at a table of four with a partner
across from them and a rival on each side. A sitting is 4 hands (`hands`), and the score is what
the player's side adds up over them.

- **A hand.** The deal moves one seat round. Every seat is dealt thirteen cards from one deck.
- **The bids.** From the seat after the dealer, each seat bids the tricks it means to take, 1 to
  13, or **nil**: that it will take none. A side's **pact** is its two bids added up, a nil counting
  nothing.
- **The tricks.** The seat after the dealer leads; whoever takes a trick leads the next. Each seat
  in turn plays one card and must follow the suit led if it can. Spades are trumps: the highest
  spade in a trick takes it, or with none the highest card of the suit led. Spades may not be led
  until one has been played on another suit (broken), unless the leader holds nothing else.
- **The count.** A side that takes at least its pact (its nil bidder's tricks not counted) scores
  10 a trick of the pact (`trickValue`) and 1 a trick over it (`bagValue`); each trick over, and
  each trick a nil bidder takes, is a **bag**. A side that takes fewer loses 10 a trick of its
  pact. A nil that takes no trick scores 100 (`nilBonus`), and one that takes any loses 100. Every
  10 bags a side gathers over the sitting (`bagLimit`) cost it 100 (`bagPenalty`). A side whose
  rivals fall short of their pact scores 10 a trick of that pact (`setBonus`).
- **A hand never scores below zero.** Whatever a side's count for a hand comes to, it adds that or
  nothing to its total. The total only climbs; a bad hand costs what it could have made, and the
  rivals' set bonus.
- **The other seats.** The partner and both rivals are played by one rule in the engine, which sees
  only what its seat could: its own cards, the bids, the cards played (and so which seats have
  shown a void) and the tricks taken. It bids its cards' count, leaning 0.4 of a trick over
  (`seatLean`); bids nil on a hand with nothing high; covers its partner's nil; plays a sure winner
  when its side needs tricks, low behind its partner, ducks once its pact is made unless the rivals
  can still be set, and lets a rival's nil take a trick. It draws nothing at random.
- **The score** is the player's side's total. A sitting left before its last hand keeps the hands
  counted; the hand in play counts for nothing.

The compound move the puzzle pays most for: **a nil made**. A hand with nothing high is bid at
nothing, and then played through thirteen tricks without taking one: dump the high cards early on
tricks already lost, keep the low ones to duck under, and trust the partner to cover. It is worth
100, ten times a trick of a pact. A nil made is called out and gets the beat.

## Luck and skill

- **Luck:** the deal. A hand of aces and spades makes its pact by itself; a hand with nothing
  makes nil or very little. Four hands is a short sample: see the open questions.
- **First skill:** following. Play low on a trick the partner is taking or one that is lost, and
  spend a high card only to take a trick. The careless bot plays any card it may and loses about
  three quarters of the score.
- **Second skill:** the bid. Count the tricks a hand will take (aces, guarded kings, spade length,
  short suits to trump) and bid that. A bid too low leaves points on the table; a bid too high
  scores nothing for the hand. Both baits are bids.
- **Third skill:** counting. Remember what has been played: a queen is a sure winner once the ace
  and king are gone, and a seat that has shown a void will trump the suit.
- **Fourth skill:** the set and the bags. Once the side's pact is made, take the tricks the rivals
  need if they can still fall short, and duck the rest rather than gather bags.
- **Fifth skill:** nil. Know a hand that can take nothing, play it through, and cover the partner's
  nil by taking the tricks it would otherwise be forced to win.

## The ladder

Not yet laddered (ADR 0066). Nil, bags and the set bonus each have an off value (`nilBonus`,
`bagLimit` and `setBonus` at 0), and the first stage would be a plain count with all three off:
bid, follow, make the pact. It waits on the owner's view of the sitting's length and luck below,
which would change what a stage is.

## Input and feedback

- Pointer: to bid, tap a number (or Nil), then the wide Bid button at the foot. To play, tap a card
  in the hand; the cards that may be played stand a little proud and the rest are dimmed. Between
  hands, the wide button deals the next.
- Keyboard: a number key picks a bid (0 is nil) and left and right step it up to 13; space or
  enter bids. Left and right pick a card among those that may be played, and space or enter plays
  it (the first that may be played when none is picked). Space or enter deals between hands.
- The other seats act on the board's own pace: 900 ms a card and 700 ms a bid after the table has
  settled, and a finished trick stays on the table 1.1 seconds, its winning card ringed, before it
  goes to its taker. The engine never moves on its own (`next` is a move in the log), so a round
  replays exactly.
- Unrated and lab rounds frame the bid or card the engine's rule would choose after six seconds
  idle (`pactHint`), and the deal button between hands.

The board follows the brand book (`docs/BRAND.md`, ADR 0061, ADR 0062): it draws its pieces in code
(`boards/src/pact/pieces.ts`) from `boards/data/pieces/pact.json`, and loads no image.

- **A card** is a raised tile with a hairline, its rank in mono in its suit's colour over its suit's
  pictogram. The hand is sorted spades, hearts, clubs, diamonds, high to low, so neighbouring suits
  differ in colour as well as shape.
- **The suits** are the traditional four, each an outline of its own: a spade's blade on a stem
  (cream), a heart (rose), a diamond (sand), a club's three leaves on a stem (moss). Spades and
  clubs both have stems; the blade's point and the club's three lobes tell them apart with the
  colour taken away.
- **A trick taken** is a small cream stack with a fold cut across it, beside each seat's count of
  tricks; **a nil** is a lilac ring in its place.
- **The table.** Bare ground, no felt and no frame. The one hairline is the edge of the player's own
  seat, over the hand. The seat to act wears an amber ring; amber is the active thing.
- **Feedback.** Each bid rises over its seat. Each card slides from its seat to the middle with a
  soft flick, and the first spade says "Spades broken" with a pop. A finished trick holds, its
  winner ringed (amber for the player's side), then slides to its taker with a tick for the
  player's side and a whoosh for the rivals'. At a hand's end the count is laid out for both sides,
  the points added rise over the player's seat, and the hand is called out.
- **Callouts**, one a hand: a nil made, the rivals set, the pact made, or short.
- **The beat** is kept for one thing: the player's own nil, made.

## Engine

`packages/engine/src/pact/`. Moves: `bid`, `play`, `next`, `deal` and `end`. A move's report holds
its events: a deal (the dealer and the player's cards), each bid, each card (and whether it broke
spades), each trick with its taker, and the count of a hand for both sides. `cards.ts` holds the
deck and the rules of a trick; `seat.ts` the rule the other seats play by.

## Tuning notes

Set from bots, not people (ADR 0036). A person's pace is modelled as 3 seconds a card and 5 a bid,
the board's 0.9 seconds a seat's turn, 1.2 seconds to see a trick and 4 seconds to read a hand's
count: a sitting is about seven minutes.

- **A hand floored at zero, not a score floored at the end.** The owner found Showdown's score
  confusing where it went below zero. Spades' own count takes a missed pact and a broken nil below
  zero; here a hand adds its count or nothing, so the total on screen only climbs, and a missed
  pact still costs the hand and pays the rivals their set.
- **The set bonus** gives defence a payoff in a round that is not a race. At 10 a trick of the
  rivals' pact it matches what a missed pact costs in the original.
- **The other seats lean 0.4 of a trick over their count** (`seatLean`). Bidding their bare count,
  they made 95 percent of their pacts and gathered 1.5 bags a hand; at 0.4 they make 86 percent,
  are set 15 percent of the time, and the set and the bags both come into play.
- **Four hands.** Each hand is about a hundred seconds; four keep a sitting near seven minutes.
  `handSeconds` (100) is that hand for the live tier indicator, which reads a stretch of play as a
  sitting of `hands` hands of that length; `paceSeconds` is 120, a little over one hand.
- **What a hand pays**, the player's side under plain play over 3000 hands: the pact 40, the set
  9, nil 6, bags 1. The pact is most of a good score; it is the game, as clearing is in a match
  puzzle, and every other mechanic feeds it.
- **Thresholds** sit so that careless play and both baits are Green, a player who follows and bids
  their count is Steady, and the engine's whole rule is Sharp. Masterful and Legendary are left for
  play no bot here reaches: bidding a hand better than the rule does, and nils made on hands the rule
  would not try.

The bots of this pass, 200 seeds (`pnpm --filter @openseas/bots ladder pact --seeds 200`):

| Bot | Full (600 s) |
|---|---|
| careless | 57 Green |
| follower | 238 Steady |
| counter | 250 Steady |
| ducker | 243 Steady |
| plain | 260 Sharp |
| greedy | 261 Sharp |
| lowball | 175 Green |
| overbid | 159 Green |
| *Steady from* | *180* |
| *Sharp from* | *255* |
| *Masterful from* | *320* |
| *Legendary from* | *400* |

- **careless**: any bid or card at random.
- **follower**: bids its count; takes a trick when it can, with only aces as sure winners; no nil,
  no ducking, no setting.
- **counter**: the follower, remembering the cards played.
- **ducker**: the counter, ducking tricks once its side's pact is made.
- **plain**: the engine's whole rule, as the other seats play.
- **greedy**: the whole rule, but takes every trick it can.
- **lowball** (a bait): the whole rule, but always bids one, a pact it cannot miss.
- **overbid** (a bait): the whole rule, but bids two over its count.

Checks: careless lands a tier below the follower; lowball loses to plain by 33 percent, overbid by
39.

Open questions for play:

- **Luck within a sitting.** A sitting's score spreads widely: plain play averages 260 with a
  spread of about 90, from 154 at the tenth percentile to 366 at the ninetieth. The means are in
  the right order and far apart; one sitting is not. Ways to narrow it: a longer sitting, or the
  same deals played twice with the seats turned (duplicate). The owner's call.
- **Bags barely bite in four hands.** A side gathers about one bag a hand, so ten are rarely
  reached, and ducking pays no more than taking (greedy and plain are level, the bags it gathers
  costing about what the sets it makes pay). A smaller `bagLimit` for a short sitting (5 bags for
  50) was tried and changed nothing between the bots; the trade between ducking and setting may
  need people to judge.
- **The pace.** 900 ms a card and 1.1 seconds on a finished trick are guesses, set from the owner's
  note on Showdown that the rivals moved too fast to follow.
- **No ladder yet**, as above.
- **Hidden cards.** The other seats' cards and the deck are in the state, which the client holds:
  a round that counted for anything would need the server to deal, as Scanner would (ADR 0036).
