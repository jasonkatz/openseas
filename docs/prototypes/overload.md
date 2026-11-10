# Overload

Status: built. Prototype (ADR 0036), on the harness at `/overload`. Ticked (ADR 0015): taps come
back on the engine's clock. A 120 second round.

## The puzzle

A bank of capacitors, six wide and seven tall, always full. Each holds a charge of 0 to 3. A tap
adds one charge to a capacitor. A capacitor that reaches 4 bursts: it empties and passes one charge
to each neighbour above, below, left and right (charge passed off the edge is lost). A neighbour
that reaches 4 bursts in the next wave, and so on until nothing is at 4.

A capacitor bursts once in a chain. After that it is spent, and charge passed to it is lost. So a
capacitor goes when its charge plus its bursting neighbours reach 4: a 3 beside one burst, a 2
between two, a 1 among three. A chain can be read before the tap, and it is never longer than the
bank.

Everything one tap sets off is one chain, and a chain of n bursts scores n × n (`burstPoints`), so
one chain of ten is worth far more than two of five. Past twenty bursts (`chainCap`) each further
burst adds twenty.

When the chain ends, every spent capacitor is swapped for a fresh one with a random charge
(`refill`). The capacitors that were passed charge and did not burst keep it, so the edge of a
chain is left hotter than it was.

Taps are scarce. The player holds up to five (`tapCap`) and one comes back every two and a half
seconds (`tapRegenTicks`). Nothing is banked while the hand is full. A tap that sets nothing off is
not wasted: it charges a capacitor, and one charge in the right place joins two clusters.

Three things sit on top of that:

- **Streak.** A chain of four or more (`streakMin`) builds a streak that multiplies the chain: 100,
  125, 150 and so on up to 300 percent at nine in a row (`streakPercent`). A shorter chain breaks
  it. A tap that bursts nothing does neither, which is the reason to charge before setting off.
- **Refund.** Every four bursts in a chain give a tap back (`refundEvery`), up to a full hand. A
  chain of four pays for its own tap; a chain of eight pays for the charge that set it up too.
- **Booster.** About one fresh capacitor in twenty-five (`boosterPermille`) is a booster. It passes
  two charges to each neighbour when it bursts, so it carries a chain through capacitors at 2.

## Luck and skill

- **Luck:** the fresh charges after a chain, and where the boosters land.
- **First skill:** reading. A 3 bursts. Touching 3s all go. A 2 between two bursting capacitors
  goes too. The best single tap is worth about a quarter more than tapping any 3.
- **Second skill:** the streak. No tap reaching four is the usual case (the best single tap
  averages a chain of four), so holding the streak means finding the one charge that makes a chain
  of four or more before setting it off. This is the largest step: a bot that does it scores 1.8
  times one that only ever takes the best single tap.
- **Third skill:** the join. One charge on the capacitor between two clusters about doubles the
  chain, and n × n pays for the tap. Two charges of set-up reach ten to fifteen.

## Input

- Tap a capacitor. The tap lands on press, and a tap during a chain finishes the chain at once.
- Keyboard: arrows or WASD move a cursor, space or enter taps.
- The strip over the bank shows the taps held as lamps, with the next one filling like a dial, and
  beside them the chain as it plays: its bursts so far and what that many are worth (the engine's
  `overloadChainValue`). Between chains it shows the streak.
- A chain plays wave by wave: each burst throws a spark to every neighbour it charged, the
  neighbours' rings fill, and the ones that are full swell and go in the next wave, each wave a
  note higher. A tap with the hand empty shakes the lamps.
- No preview of a chain in any round: reading it is the game. Unrated and lab rounds mark a tap
  after five seconds idle (`overloadHint`): a ring on the tap that sets off the longest chain, or,
  when that chain is too short for the streak and one charge would make a longer one, a ring with a
  plus on the capacitor to charge.
- A capacitor's charge is the count of lit parts of its ring, cut in three; a 3 shows a bolt and a
  booster has a second ring with four lugs. The marks setting draws the charge as a digit.

## Engine

`packages/engine/src/overload/`. Moves: `{ type: "tap", cell, tick }`, `{ type: "wait", tick }` and
`{ type: "end", tick }`. The state holds the taps and the tick the next one is counted from, and the
reducer counts the taps that have come back by a move's tick before it applies the move;
`advanceOverload(state, tick)` does the same for display without logging anything. A tap's report
is a `tap` event and, when it set one off, a `chain` event: the waves (the cells that burst in each
and every cell's charge after it), the streak, the refund, the fresh capacitors and the points.
Events carry a rising `seq`, so the board plays each once.

## Tuning notes

Set from bots, not people (ADR 0036). Thirty rounds a bot, one tap every 1.5 seconds unless said.
The bots: one taps at random; one taps any 3; one taps the biggest clump of touching 3s; one takes
the best single tap; one looks one charge ahead (it sets off a chain of four or more, charges
first when no tap reaches four, and also when one charge adds 70 points or more); one looks two
ahead.

| Bot | Score at 1.5 s a tap | At 2.5 s | At 1 s |
|---|---|---|---|
| Random taps | 1,069 | 565 | 1,100 |
| Any 3 | 2,459 | 1,288 | 3,017 |
| Biggest clump of 3s | 2,897 | 1,631 | 3,983 |
| Best single tap | 3,177 | 1,744 | 4,539 |
| One charge ahead | 5,804 | 2,544 | 8,349 |
| Two charges ahead | 6,371 | | |

- **A capacitor bursts once in a chain.** As first written a burst capacitor could fill and burst
  again in the same chain. At a tap a second, a round's longest chain then averaged 48 bursts on a
  bank of 42, and the bot that took the best single tap scored the same as the one that charged
  first (about 29,800 each, at two points a burst): nothing could be read and nothing was worth
  planning. Once per chain, a chain is a shape on the bank.
- **Spent capacitors are swapped, not kept.** The brief asked whether a burst capacitor should keep
  the charge it was passed. Tried over twenty rounds: one round in ten of the best-single-tap bot
  scored under 330 and one in ten over 20,000 (median 3,795). The bank either dies or runs away, so
  it is swapped for a fresh one.
- **Fresh charges at 30, 35, 25, 10.** The brief's first guess (20, 34, 30, 16) is too hot: the best
  single tap averages a chain of 6.3 and a bot that never plans gets sixteen chains of ten or more
  a round. At 30, 35, 25, 10 the best single tap averages 4.2, one charge of set-up 8.3 and two
  11.7. Colder (50, 30, 15, 5) the chains average 2.3 and nothing happens. The average charge on
  the bank settles near 1.7 whatever is dealt, because every chain heats its own edge.
- **The streak goes to triple, not double.** With the brief's numbers (a tap back at eight bursts, a
  tap every two seconds, a streak to 200 percent) the bot one charge ahead beat the best single tap
  by 1.27 times (3,363 to 2,639): a charge spent is a chain not set off, and small chains heat the
  bank for nothing. A tap back every four bursts and a tap every 2.5 seconds made it 1.42 (3,996 to
  2,815). The streak to 300 percent made it 1.83 (5,804 to 3,177): nine rounds in ten of the first
  bot are over 4,330 and nine in ten of the second under 4,380.
- **A tap back every four bursts.** At eight, taps were the limit for every bot and a careful one
  waited 13 seconds of a round with an empty hand. At four, a bot that plans is short of a tap for
  under a second a round, one that taps any 3 for five seconds, and one that taps at random for 25:
  wild tapping is what starves.
- **Boosters stay.** Without them the same two bots score 2,123 and 4,024; with them 3,177 and
  5,804. They make the long chains, and a booster at 2 beside a cluster is the charge worth making.
- **Thresholds** are the table at a human pace: 500 is random tapping, 1,200 any 3 at an easy pace,
  2,000 reading at an easy pace, 3,000 the best single tap at a brisk one, 4,500 and 6,500 one
  charge ahead from an easy pace to a brisk one.

## Open questions for play

- The streak pays more than the join. A bot that charges only to reach four scores 5,505, about a
  twentieth under the one that also charges for bigger chains (5,804). Both bots' chains are mostly
  four to six; the one that joins adds one or two of twenty or more a round. If people play it as
  steady fours, the join needs more: a steeper score, or a streak that grows with the chain's
  length instead of its count.
- Chains come in two sizes. A bot told to charge for any gain of 20 points ends with chains of four
  to six and chains of thirty, little between, and scores a third of the others (1,898 against
  5,801 over the same sixteen rounds): a chain that takes most of the bank leaves it cold. Ten to fifteen may be harder to make on purpose than
  the averages suggest.
- Is one tap every 2.5 seconds right for a first round, when taps are being spent to learn?
- Are boosters worth their rule, or is the second ring one thing too many to read?
- The score in the HUD is the engine's at once; the chain is still playing on the board.
