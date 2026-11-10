# Deflectors

Status: built. Prototype (ADR 0036), on the harness at `/deflectors`. Ticked (ADR 0015): volleys
charge and fire on the engine's clock. A 120 second round.

## The puzzle

A six by six grid with fourteen mirrors on it (`mirrors`), each set as `/` or `\`. A tap on a mirror
flips it. That is the one verb. Mirrors never move, and empty cells let a beam pass straight through.

Beams come in from ports on the edge, in volleys. A volley is one beam for the first 35 seconds
(`rampTicks`) and two beams after that (`maxBeams`). A volley is announced before it fires: each
beam's entry port wears its sign, its exit port wears the same sign as an outline, and one count
runs for the whole volley. The count is 18 seconds at the start of the round and 13 by the end
(`chargeTicks`, `chargeTicksMin`), with 5 more for a second beam (`beamTicks`).

When the count ends every beam fires at once. It runs straight, turns at every mirror it meets, and
leaves by some port.

- **Home.** Out through its own exit, a beam scores by the mirrors it turned at: (turns + 1)
  squared (`beamPoints`). Three turns are 16, seven are 64, eleven are 144.
- **Hull.** Out anywhere else, it costs 40 (`hullPenalty`). The score never goes below zero.

A volley with every beam home is clean. Clean volleys build a streak that multiplies the next clean
one: 100, 110, 120 and so on to 200 percent at nine (`streakPercent`). One beam into the hull ends
the streak.

Every volley is dealt exits that one setting of the mirrors reaches together; the engine searches
the settings when it deals. It keeps the most the volley can be worth as its `best`, and the strip
over the grid shows it beside what the volley is worth now. A clean volley worth its best is
perfect and scores half as much again (`perfectPercent`). No beam is dealt the exit it already runs
to, so a volley left alone goes into the hull.

A tap on a lit entry port fires the volley now. The next one is dealt 0.6 seconds after a volley
fires (`respawnTicks`), so a quick hand sees more volleys in a round.

## Luck and skill

- **Luck:** where the mirrors are, and where beams enter and must leave.
- **First skill:** getting a beam home. The board draws two lines for a beam that is not home: a
  broken line from its entry to where it would leave, and dots running back from its exit. Where the
  two cross at a mirror, flipping that mirror joins them. When they do not cross, a flip on either
  line moves it.
- **Second skill:** two beams on one grid. A mirror flipped for the second beam may be on the first
  beam's route, and both lines show it at once.
- **Third skill:** pace. A player who fires early scores more than twice one who waits out every
  count.
- **Fourth skill:** the long way round. The first route found is worth about a third of the best
  one. Seeing the long route, not stumbling on it, is what the top scores are made of.

## Input

- Tap a mirror to flip it. Tap a lit entry port to fire the volley.
- Keyboard: arrows or WASD move a cursor, space or enter flips the mirror under it, F fires.
- The last three seconds of a count tick, and the count's ring turns red.
- A fired beam draws its whole path, a spark and a rising note at each turn, and its points at the
  port it leaves by. A perfect volley, a route of eight turns or more and a streak of three or more
  are called out; a beam into the hull shakes the board.
- Each beam has its own shape: a circle, a square, a triangle. The beads on a route that is home
  are that shape. The mark setting adds pips to the signs.
- Unrated and lab rounds pulse the next mirror to flip after five seconds idle: a flip towards the
  volley's best setting. Following it keeps it coming.

## Engine

`packages/engine/src/deflectors/`. Moves: `{ type: "flip", cell, tick }`, `{ type: "fire", volley,
tick }`, `{ type: "wait", tick }`, `{ type: "end", tick }`. The reducer first carries the grid to
the move's tick: a volley whose count has ended fires, and the next is dealt when it is due. A fire
names the volley it means, so a tap that lands after its volley has gone fires nothing.

`trace` runs one beam through the mirrors as they stand. `resolve` is what a volley does fired now:
the board previews with it (`outlook`) and the reducer scores with the same function. Events are
`deal` and `fire`, numbered with a rising `seq`.

The search (`volleyOptions`, `volleyRoute`) walks the beams in order and tries both settings of
each mirror the first time a beam meets it, so it visits each thing one grid can do once. It is in
a fixed order and stops after 40,000 mirror meetings. On the content grid a search spends a median of 95
meetings, and 915 at most over 3,000 sampled volleys. A reduce on the content config takes 0.03 ms
on average. A player who fires every volley the tick it is dealt (199 volleys) costs 6 ms for the
whole round. The budget is only reached on lab grids far from content (eight by eight with thirty
mirrors and three beams): a deal there costs about 5 ms and deals the best exits found so far.

## Tuning notes

Set from bots, not people (ADR 0036). Sixty rounds a bot on the content config.

| Bot | Score | Volleys | Beams home | Hull | Share of best |
|---|---|---|---|---|---|
| Never flips | 0 | 6.0 | 0.1 | 9.9 | 0% |
| Joins lines, 1.5 s a flip | 258 | 7.5 | 9.1 | 2.5 | 28% |
| Joins lines, 1.1 s a flip | 462 | 9.1 | 12.6 | 1.7 | 32% |
| Joins lines, 0.8 s a flip | 750 | 11.8 | 17.3 | 1.4 | 35% |
| Joins lines, 0.6 s a flip | 1166 | 14.9 | 23.0 | 1.0 | 39% |
| Joins lines, 0.4 s a flip | 1781 | 19.6 | 30.9 | 0.9 | 42% |
| Joins lines, 0.8 s, never fires early | 286 | 6.0 | 9.1 | 0.9 | 33% |
| Joins, then tries three times to lengthen, 0.8 s | 608 | 8.2 | 11.6 | 1.4 | 42% |
| Longest route, 8 s a beam | 1139 | 7.3 | 8.3 | 2.9 | 77% |
| Longest route, 6 s a beam | 2265 | 8.9 | 13.3 | 0.2 | 98% |
| Longest route, 4 s a beam | 3729 | 12.6 | 19.5 | 0.0 | 100% |
| Longest route, 2.5 s a beam | 5910 | 18.6 | 29.2 | 0.0 | 100% |

The joining bot plays as the two lines suggest: it flips a mirror where a beam's line and the way
back cross, and otherwise flips something on either line and looks again. The longest bot is handed
the best setting by the search and only pays for thinking time.

- **Volleys, not beams with a count each.** The brief had two or three beams waiting, each with its
  own count, and a tap to fire one. With that, a player sets the mirrors for one beam, fires it, and
  sets them for the next: beams never share the grid, and the second beam is only a look ahead. A
  volley fires together, so two beams must be home on one setting. The joining bot still brings both
  home in 85 percent of two-beam volleys at 0.8 s a flip, so it is harder without being a wall.
- **Mirror wear is dropped.** The brief had mirrors burn out after three turns and reappear
  elsewhere. That was not simulated. It was dropped because it moves the grid while a volley waits:
  the route a player has half built changes under them, the best has to be worked out again, and a
  beam may need a new exit mid-count. The first builder had reached the same view. The grid shifting
  all round is the thing lost; whether a round on one grid goes stale is a question for play.
- **Fourteen mirrors, not sixteen.** With sixteen the best routes are longer (8.2 turns a beam
  against 7.0) but the joining bot needs a median of four flips for one beam and six for two, and a
  tenth of its volleys are not home after forty flips. With fourteen the medians are two and four.
  With twelve, half of all volleys are one flip a beam and there is little to find.
- **The way back from the exit is drawn.** Without it, finding a route is trial and error. With it
  there is a rule to learn, and the joining bot is that rule.
- **Trying flips to lengthen a route does not pay.** From a route that is home, a second route one
  or two flips away that is longer exists for about one mirror in twenty. The bot that spends three
  tries on it scores 608 against 750 for firing at once. The long route has to be seen, which the
  longest bot stands in for: at six seconds a beam it scores three times the joining bot. This is
  the weakest part of the design; see the open questions.
- **No beam is dealt the exit it already runs to.** Otherwise about one beam in twelve is home
  untouched, and firing volleys as they come is worth a little for no thought.
- **The hint goes to the best setting, not the nearest.** A hint to the nearest clean setting and
  then to the best would send a player back and forth; towards the best, each flip is one fewer to
  go.
- **Thresholds.** 150, 400, 800, 1500, 2600 and 4000 for ratings 1100 to 2100. The slow joiner
  clears the first, the 0.8 s joiner sits at the third, the fastest joiner clears the fourth, and
  the last two need long routes at six and four seconds a beam.

## Open questions for play

- Can a person learn to see the long route in the time a volley gives, or is the best only ever a
  number on the strip? If the second, the perfect bonus is dead and something nearer should pay.
- Does one grid for the whole round go stale, or is knowing it part of the skill?
- Is five more seconds enough for a second beam late in the round?
- Do the dots make the first skill too easy once the crossing rule is known?
- Three beams a volley is a lab preset. Is it a puzzle or a mess?
