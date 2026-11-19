# Overload

Status: built, with the draw (M11) and a ladder of three stages. Prototype (ADR 0036), in the studio at `/overload`. Ticked (ADR 0015): taps come
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

Four things sit on top of that:

- **Streak.** A chain of four or more (`streakMin`) builds a streak that multiplies the chain: 100,
  125, 150 and so on up to 300 percent at nine in a row (`streakPercent`). A shorter chain breaks
  it. A tap that bursts nothing does neither, which is the reason to charge before setting off.
- **Refund.** Every four bursts in a chain give a tap back (`refundEvery`), up to a full hand. A
  chain of four pays for its own tap; a chain of eight pays for the charge that set it up too.
- **Booster.** About one fresh capacitor in twenty-five (`boosterPermille`) is a booster. It passes
  two charges to each neighbour when it bursts, so it carries a chain through capacitors at 2.
- **The draw** (M11). Under the bank the ship asks for a chain of a size: a band from a draw
  (`drawSizes`) to one more (`drawSpan`). A chain whose bursts land in the band meets the draw and
  scores double (`drawPercent`) on top of the streak, and the next draw is asked for. The draws come
  in turn, 8 to 9, 9 to 10 and so on up to 12 to 13, then round again from 8 to 9; `drawRandom` picks
  each next one at random from the list instead. A chain past the band is only a chain. Any chain
  counts against it, a short one too. The draw has a stream of its own (`overload-draw:<seed>`), so
  turning it on deals the same bank. Off: `drawSizes: []`, and a round hashes as it did before.

## Luck and skill

- **Luck:** the fresh charges after a chain, and where the boosters land. The draws are not luck
  while they come in turn: the next is always one more. A chain in the band by chance is luck, and
  the bots show it is small (below).
- **First skill:** reading. A 3 bursts. Touching 3s all go. A 2 between two bursting capacitors
  goes too. The best single tap is worth about a quarter more than tapping any 3.
- **Second skill:** the streak. No tap reaching four is the usual case (the best single tap
  averages a chain of four), so holding the streak means finding the one charge that makes a chain
  of four or more before setting it off. This is the largest step: a bot that does it scores 1.8
  times one that only ever takes the best single tap.
- **Third skill:** the join. One charge on the capacitor between two clusters about doubles the
  chain, and n × n pays for the tap. Two charges of set-up reach ten to fifteen.
- **Fourth skill:** the draw (M11), the join with a ceiling. Count the chain the best tap makes, then
  find the charge, or two, that brings it into the band, and stop there: a chain of 9 in a draw of 8
  to 9 pays 162, more than a chain of 12 out of it. It is planned (two charges ahead pays most), it
  moves (each met draw asks for one more), and it adds the sense of what is not worth chasing: one
  more charge that makes a longer chain looks right and loses the double.
- **The compound move:** the join into the draw. Two clusters, one charge between them, set off
  as one chain that lands in the band, on a running streak.

## Input and feedback

- Tap a capacitor. The tap lands on press, and a tap during a chain finishes the chain at once.
- Keyboard: arrows or WASD move a cursor, space or enter taps.
- **The draw's row**, under the bank while the draw is on: `Draw 8 to 9 ×2` on the left, dim. On a
  desktop, with the mouse over a capacitor at 3 or the keyboard's cursor on it, the right of the row
  counts the chain a tap there sets off and says whether it meets the draw (`8 meets it`, cream, with
  a tick), falls short (`5 is short`) or runs past it (`12 is past it`), dim: the engine's
  `overloadChainSize` and `overloadDrawMet`, read in words, so the row reads without colour. A
  touch has no hover: on a phone the chain is counted by eye (an open question, below).
- No preview of a chain on the bank: reading it is the game. Unrated and lab rounds mark a tap
  after five seconds idle (`overloadHint`): a cream ring on the tap that sets off the longest
  chain, or, when that chain is too short for the streak and one charge would make a longer one, a
  ring with a plus on the capacitor to charge.

The board is restyled to the brand book (`docs/BRAND.md`, ADR 0061, ADR 0062): it draws its pieces
in code (`boards/src/overload/pieces.ts`), loads no atlas and has no marks setting.

- **Pieces.** A capacitor is a flat disc, seen from above. A booster is a disc with four lugs, one
  towards each neighbour, so the two are told apart by outline. The charge is a rule's number on
  the piece, so it is part of the drawing: one hole cut for each charge, the ground showing
  through. The colour steps with the charge as a second cue (slate at none, sky, sand, rust), and a
  capacitor at four, full and about to burst, is cream with four holes.
- **The board.** Bare ground with one hairline round the strip and the bank. No frame and no grid;
  a small dot marks the gap a burst capacitor leaves.
- **The strip** over the bank shows the taps held as lamps: a lit one is an amber dot (the taps
  are the player's own), the next one fills like a dial in a duller amber, the rest are empty
  sockets. Beside them is the chain as it plays, in mono: its bursts so far and what that many are
  worth (the engine's `overloadChainValue`). Between chains it shows the streak, dim.
- **A tap** is ringed in amber for a moment and the capacitor gains its hole at once. A tap with
  the hand empty turns the sockets to danger and says so.
- **A chain** plays wave by wave: each burst capacitor shrinks to nothing, one dot of charge runs
  to every neighbour it charged (a bigger dot from a booster), the neighbours gain their holes,
  and the ones now full go in the next wave, each wave a note higher. The points rise from the
  middle of the chain in cream; a tap given back is said in amber by the lamps; a lost streak in
  danger. Fresh capacitors grow into the gaps.
- **The beat**, one amber pulse of the whole board, is kept for two things: a chain of ten or more
  (called out, and stronger the longer the chain, to a chain of twenty), and a streak brought to
  its top. There is no shake, no flash and no glow.
- **A met draw** is called out (`Draw met`, over any other callout) on the rising cue (`rise`), or
  under the beat with no cue of its own when the chain is ten or more. The row keeps the draw the
  chain met until then, and steps to the next as the callout lands.

## Engine

`packages/engine/src/overload/`. The draw's queries: `overloadDrawBand` (the band now and what it
pays), `overloadDrawMet` (whether a chain of n meets it), `overloadChainPoints` (what a chain of n
set off now scores, the streak and the draw in), `overloadChainCells` (the capacitors a tap bursts)
beside `overloadChainSize`. A chain event carries `drawMet`, `drawPoints` and the next `draw`; the
state holds `draw`, `drawIndex`, the draw's own stream, `draws` and `drawScore`, all hashed only when
the draw is on (three seeds' hashes from before the draw are pinned in the tests). Moves: `{ type: "tap", cell, tick }`, `{ type: "wait", tick }` and
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

## The ladder

A new player climbs two stages before the whole puzzle (ADR 0066), each the puzzle with layers
switched off in `stages` in the content file; names and cards are `overload.stage.<id>` and `_intro`.

| Stage | Round | What is on | Switched off |
|---|---|---|---|
| Bursts | 60 s | Reading chains, n × n, refunds | The streak (`streakPercent: [100]`), boosters (`boosterPermille: 0`), the draw (`drawSizes: []`) |
| Streak | 90 s | The streak, boosters | The draw |
| The draw (full) | 120 s | The draw, 8 to 12 rising, ×2 | |

Each stage also ends its clock at its round (`maxTick` 600 and 900). On bursts, charging pays
nothing (there is no streak to keep), so reading is the whole stage and the one-move bot is the
best; on streak, charging to four takes a bot from Sharp to Masterful, the stage's lesson.

## Tuning notes: the draw (M11)

Set from bots (ADR 0067), `pnpm --filter @openseas/bots ladder overload --seeds 32`, at a tap every
1.5 seconds. The new bots: **joiner** (blind to the draw: charges to reach four, and when one charge
doubles the best tap); **seeker** (blind: looks two charges ahead, a charge's chain worth half, two
charges' a third); **draw joiner** and **draw seeker** (the same, every tap weighed by what the engine
would pay for it with the draw: `overloadChainPoints`); **biggest chain** (the bait: the draw joiner,
but once the best tap meets the draw it charges for any longer chain).

32 seeds a cell (seeds `ladder-0` to `ladder-31`); each cell is the mean score and the tier it reads as on that stage.

| Bot | Bursts (60 s) | Streak (90 s) | Full (120 s) |
|---|---|---|---|
| careless | 119 Green | 542 Green | 1,068 Green |
| one move | 676 Sharp | 2,426 Sharp | 3,879 Sharp |
| rollout | 748 Sharp | 2,395 Sharp | 4,378 Sharp |
| any 3 | 607 Steady | 1,624 Steady | 2,601 Steady |
| biggest clump | 563 Steady | 1,680 Steady | 3,020 Sharp |
| charge to four | 478 Steady | 3,621 Masterful | 6,129 Masterful |
| one charge ahead | 497 Steady | 3,588 Masterful | 5,361 Masterful |
| joiner | 454 Steady | 2,995 Sharp | 5,350 Masterful |
| seeker | 498 Steady | 2,878 Sharp | 5,451 Masterful |
| draw joiner | 454 Steady | 2,995 Sharp | 6,829 Masterful |
| draw seeker | 498 Steady | 2,878 Sharp | 7,371 Masterful |
| biggest chain (bait) | 454 Steady | 2,995 Sharp | 4,408 Sharp |
| greedy charge (bait) | 318 Steady | 1,215 Steady | 2,245 Steady |
| *Steady from* | *300* | *799* | *1,299* |
| *Sharp from* | *625* | *1,749* | *2,748* |
| *Masterful from* | *1,000* | *3,198* | *4,996* |
| *Legendary from* | *1,599* | *5,447* | *8,744* |

The checks: careless lands a tier below one move on every stage; the greedy charge loses to one
charge ahead by 58 percent; the biggest chain loses to the draw seeker by 40 percent.

The key gaps at 64 seeds, the draw on and off (`--set 'drawSizes=[]'`):

| Bot (full, 64 seeds) | No draw | The draw |
|---|---|---|
| charge to four (blind) | 5,521 | 6,215 (+12.6%) |
| one charge ahead (blind) | 5,364 | 5,659 (+5.5%) |
| joiner (blind) | 4,834 | 5,541 |
| seeker (blind) | 4,858 | 5,743 |
| draw joiner (plays it) | | 7,150 |
| **draw seeker** (plays it) | | **7,644** |
| biggest chain (the bait) | | 4,628 |

The draw seeker beats the best bot blind to the draw (charge to four) by **23.0 percent**; the best
blind bot gains 12.6 percent without trying (the pitch's 8 to 10 at ×3 gave it 44 to 50); the draw is
**37 percent** of the seeker's score (rule 14: under 40); the bait loses 39.5 percent. Looking two
charges ahead gains nothing blind (seeker 4,858 to charge to four's 5,521 with no draw) and 7 percent
with the draw (draw seeker over draw joiner): the draw is what makes planning pay.

**The search.** The owner asked for the pitch's draw tuned down: a narrower band, a lower multiplier,
and a band that moves, until the bot that plays it beats the best blind one by 15 percent or more, the
blind bots' free gain shrinks well below 50 percent, the draw is under about 40 percent of a good
score, and the bait still loses. The playing bot is the best of draw joiner, a draw grower (charges to
grow a chain short of the band while it holds three taps) and draw seeker; the blind bot is the best
of charge to four, one charge ahead, joiner and seeker. Every row at ×2 or less loses to the first
condition or passes all four; the closest are listed.

| Band (seeds) | ×   | Plays it vs best blind | Blind free gain | Draw's share | Bait |
|---|---|---|---|---|---|
| 8 to 10 fixed, the pitch (32) | 3 | +38.2% | +44.3% | 57.3% | −60% |
| 8 to 9 fixed (32) | 2 | +10.5% | +16.5% | 34.5% | −36% |
| 8 to 9 fixed (32) | 1.75 | +4.0% | +12.4% | 27.8% | −28% |
| 8 fixed (32) | 2 | +11.1% | +9.9% | 29.1% | −33% |
| 9 to 10 fixed (32) | 2 | +17.7% | +12.2% | 37.4% | −38% |
| 9 fixed (32) | 2 | +13.9% | +6.6% | 30.1% | −32% |
| 10 to 11 fixed (32) | 2 | +26.5% | +9.3% | 37.7% | −40% |
| 10 to 11 fixed (64) | 2 | +25.4% | +10.6% | 37.8% | −37% |
| 10 to 11 fixed (32) | 1.75 | +13.4% | +7.0% | 29.1% | −34% |
| 10 fixed (32) | 2 | +21.1% | +5.7% | 32.7% | −36% |
| 10 to 12 fixed (32) | 1.75 | +12.0% | +11.6% | 32.2% | −35% |
| 11 to 12 fixed (32) | 2 | +21.4% | +9.7% | 36.6% | −39% |
| 11 fixed (32) | 2 | +12.9% | +3.7% | 30.6% | −30% |
| **8 to 12 rising by one, span 1 (64)** | **2** | **+23.0%** | **+12.6%** | **37.0%** | **−40%** |
| 8 to 12 rising by one, span 1 (32) | 1.75 | +8.2% | +9.1% | 30.2% | −31% |
| 8 to 12 rising by one, span 0 (32) | 2 | +19.0% | +6.2% | 33.2% | −36% |
| 8, 10, 12 rising, span 1 (64) | 2 | +19.0% | +12.9% | 38.0% | −36% |
| 8 to 12 at random, span 1 (64) | 2 | +20.3% | +12.8% | 36.4% | −38% |
| 9 to 12 at random, span 0 (32) | 2 | +16.6% | +6.5% | 31.0% | −34% |
| 6 to 11 at random, span 0 (16) | 2.5 | +16.2% | +8.5% | 35.3% | −40% |

- **×2, not ×3 and not ×1.75.** At ×3 (the pitch's 8 to 10) the draw is more than half a good score, and at ×2.5 it passed 40 percent in most bands. At
  ×1.75 and below, no band gave the playing bot 15 percent: the double is the least that pays for
  the charges it takes to build into a band.
- **A band of two.** A band of three (8 to 10) is the pitch's free gain: blind bots' chains of 8 to
  11 happen by luck, the contracts trap. A band of one (exactly 10) has the smallest free gain and
  still a gap, but asks a player to count to the burst; a band of two forgives one.
- **Rising, picked over fixed 10 to 11.** Fixed 10 to 11 has the widest gap (+25 percent), but it is
  the same target all round and once learned is a rule of thumb. Rising by one from 8 to 9 to 12 to
  13, then round again, keeps a gap almost as wide (+23), moves (each met draw asks for a harder
  one, and the easy one returns), and keeps the free gain at an eighth. At random it does about the
  same (+20); in turn, the next draw is a thing to plan for, which is the skill.
- **The bait.** Charging for a longer chain once the best tap meets the draw scores 40 percent less
  than stopping, and lands a tier lower (Sharp). The greedy charge, the old bait, still loses.
- **Thresholds** for the whole puzzle rose with the draw: 550, 1,300, 2,200, 3,300, 5,000 and 7,500
  (were 500, 1,200, 2,000, 3,000, 4,500, 6,500). Plain play gains about a tenth from chains that
  land in the band by luck (one move 3,511 to 3,879), so the lower ones rose a tenth; the top two
  rose with the draw seeker, which now sits high in Masterful. The stages' thresholds are first
  guesses from their bots: bursts puts the best reader at Sharp, streak puts charging to four at
  Masterful. All of them want setting by hand in the studio.
- **Tried and failed** (the pitch's measures, kept as negatives): surge, a long chain moving the
  streak a step per four bursts (careless gained 55 percent and every bot alike), and the load, one
  marked capacitor paying double when burst (sprawling lucky chains hit it, blind bots gained 27
  percent and the bot that sought it scored less). Neither is in the engine.

## Open questions for play

- **Is counting a chain against the band fair on a phone?** A desktop has the row's count at the
  cursor; a touch lands at once and has no hover, so a phone player counts 9 against 12 bursts by
  eye. The bots count perfectly. If people miss the band by one too often, the choices are a
  touch preview (a press that shows the count before a second tap fires, which costs the one-tap
  verb), a band of three, or the count shown on the bank for every 3. Play-test first.
- Do people feel the rising draw as a ladder within the round, or as noise? Fixed 10 to 11 is the
  fallback with the widest gap.
- The draw makes the long chains matter again, which the open question below asked for. Do people
  now join, or still play steady fours and take the draw when it comes?

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
