# Deflectors

Status: built. Prototype (ADR 0036), in the studio at `/deflectors`. Ticked (ADR 0015): volleys
charge and fire on the engine's clock. A 120 second round. Deepened in M11 with locks, and learned
on a ladder of four stages (ADR 0066).

## The puzzle

A six by six grid with fourteen mirrors on it (`mirrors`), each set as `/` or `\`. A tap on a mirror
flips it. That is the one verb. Mirrors never move, and empty cells let a beam pass straight through.

Beams come in from ports on the edge, in volleys. A volley is one beam for the first 35 seconds
(`rampTicks`) and two beams after that (`maxBeams`). A volley is announced before it fires: each
beam's entry port wears its sign, its exit port wears the same sign with its middle cut out, and one count
runs for the whole volley, as a bar over the grid. The count is 18 seconds at the start of the round and 13 by the end
(`chargeTicks`, `chargeTicksMin`), with 5 more for a second beam (`beamTicks`).

When the count ends every beam fires at once. It runs straight, turns at every mirror it meets, and
leaves by some port.

- **Home.** Out through its own exit, a beam scores by the mirrors it turned at: (turns + 1)
  squared, times `bouncePoints` (1), with turns counted up to `bounceCap` (16, a guard no content
  route reaches). Three turns are 16, seven are 64, eleven are 144.
- **Hull.** Out anywhere else, it costs 40 (`hullPenalty`). The score never goes below zero.

A volley with every beam home is clean. Clean volleys build a streak that multiplies the next clean
one: 100, 110, 120 and so on to 200 percent at nine (`streakPercent`). One beam into the hull ends
the streak.

Every volley is dealt exits that one setting of the mirrors reaches together; the engine searches
the settings when it deals. It keeps the most the volley can be worth as its `best`, and the strip
over the grid shows it beside what the volley is worth now. A clean volley worth its best is
perfect and scores half as much again (`perfectPercent`). No beam is dealt the exit it already runs
to, so a volley left alone goes into the hull. Of the exits the mirrors can reach, the deal picks
among those worth routing to: a best of at least a four-turn beam a beam (`minBest`), and a cheaper
setting that reaches them too, so there is a long way round to find and a short way home to fall
back on. A grid with none deals the best exits it saw.

A tap on a lit entry port fires the volley now. The next one is dealt 0.6 seconds after a volley
fires (`respawnTicks`), so a quick hand sees more volleys in a round.

**Locks.** When a volley fires, the last mirror each beam turned at locks for the next volley
(`hotTurns: 1`, `hotVolleys: 1`): it cannot be flipped, and a tap on it is refused. The next volley
is dealt with the locked mirrors read as set the way they stand, and its `best` is the most the
free mirrors can make it, so every volley can still be routed home and can still be perfect. A beam
into the hull locks the end of its route too. When that volley fires its own locks replace them.
Off: `hotVolleys: 0`, which deals and scores every seed as it was before locks.

A volley's best is decided with the locks it is dealt; what is locked is decided by the route the
player fired before. So the route fired now chooses which mirror the next volley loses. Two routes
of about the same worth can leave the next grid very differently: one ends on a mirror at the
heart of the grid's loops, the other on one few beams meet.

## Luck and skill

- **Luck:** where the mirrors are, and where beams enter and must leave. Locks add no luck of their
  own: what locks is the end of the route the player fired. The next volley's ports are not shown
  before it is dealt, so which mirror it will want free is a guess about the grid, not a read.
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
- **Fifth skill:** leaving the grid open. Under locks the long way round is still the compound move,
  but the route fired now decides which mirror the next volley cannot use. Firing the best route
  every volley is the bait: it is right for this volley and costs the next one. A bot that looks
  past the volley in hand (rollout, on a fresh stream, so it never sees the next ports) scores 17
  percent more than one that takes each volley's best alone. What a person should look for (keep
  the mirrors most long routes pass through free, end routes where few beams turn) is the bots'
  reading of it, not yet a person's; see the open questions.

**The compound move:** the long way round, ended where the next volley will not need to turn.

## The ladder

A new player climbs four stages (ADR 0066), each passed with one Steady round. Only the whole
puzzle counts. Every stage is the whole puzzle with layers switched off in `stages` in the content
file; the names and one-line cards are `deflectors.stage.<id>` and `_intro`.

| Stage | Round | What is on | Switched off |
|---|---|---|---|
| Route | 60s | One beam a volley, joining the lines, firing early, the streak | The second beam (`maxBeams: 1`), perfect (`perfectPercent: 100`), locks (`hotVolleys: 0`) |
| Pairs | 90s | Two beams after the ramp | Perfect, locks |
| The long way round | 120s | Perfect: a volley worth its best | Locks |
| Full deflectors | 120s | Locks | |

The pitch had the streak arrive with pairs. On `route` without it the careless bot (278) barely
trailed the joiner (385); with it they are 310 and 596, so the streak stays on from the first
stage. A stage with perfect switched off never calls a volley perfect: the board says nothing a
stage does not pay for. `route` and `pairs` set `maxTick` to their own round. Each stage's
thresholds are set from the bots (see the tuning notes) and want setting by hand.

## Input and feedback

- Tap a mirror to flip it. Tap a lit entry port to fire the volley.
- Keyboard: arrows or WASD move a cursor, space or enter flips the mirror under it, F fires.
- Unrated and lab rounds pulse a cream ring on the next mirror to flip after five seconds idle: a
  flip towards the volley's best setting. Following it keeps it coming.

The board is restyled to the brand book (`docs/BRAND.md`, ADR 0061, ADR 0062): it draws its pieces
in code (`boards/src/deflectors/pieces.ts`), loads no atlas and has no marks setting.

- **Pieces.** A mirror is a bar on a pivot. A `/` and a `\` are the same picture a quarter turn
  apart, so the way a mirror is set is its outline. Each beam has a sign with a silhouette of its
  own: a disc, a square, a triangle, in sand, rose and moss. An entry port wears the sign solid,
  with a small arrow into the grid; an exit port wears it with its middle cut out, and it fills
  when the beam is home.
- **A locked mirror** (`mirror-locked`) is the same bar on a square bolt with a slot cut across it,
  in slate, the palette's inert colour. Its outline (a square boss where a free mirror has a round
  one) and its cut-out (a slot where a free mirror has a round pivot hole) tell it from a free
  mirror with the colour taken away. It changes the moment the volley that locked it fires, and back
  when the next one does.
- **A tap on a locked mirror** is refused at once, before anything is sent: the refusal's low bump,
  one ring in danger round the mirror, and the word "Locked" rising over it in danger. The idle
  hint never points at a locked mirror.
- **The board.** Bare ground under the strip, the ports and the grid. The one hairline is round
  the grid, because a beam leaves across it. No frame and no grid lines: a small dot marks every
  cell, so an empty one a beam runs straight through is seen, and every port.
- **The strip** over the grid says, in mono, what the volley is worth now and the best it could be,
  and under it the count is a plain bar that drains. The last three seconds tick and the bar turns
  to danger.
- **A waiting beam's lines.** Home, its route is a solid line in its colour, beaded with its own
  sign so two routes that cross are told apart. Astray, it is a broken line to the port it would
  leave by, with a cross there in danger, and dots run back from its exit. When every beam is home
  the entries are ringed in amber: the thing to tap.
- **A flip** turns the mirror in 120ms. **A fired beam** draws its whole path as one flat line
  with a cream dot at its head and a rising note at each turn, and its points rise in cream at the
  port it leaves by. A beam into the hull leaves one ring in danger at that port, its cost, and
  the callout in danger. A streak of three or more is called out.
- **The beat**, one amber pulse of the whole board, is kept for two things: the long way round (a
  route of eight turns or more, stronger the longer it is) and a perfect volley (strongest when it
  also went the long way). There is no shake, no flash and no sparks.

## Engine

`packages/engine/src/deflectors/`. Moves: `{ type: "flip", cell, tick }`, `{ type: "fire", volley,
tick }`, `{ type: "wait", tick }`, `{ type: "end", tick }`. The reducer first carries the grid to
the move's tick: a volley whose count has ended fires, and the next is dealt when it is due. A fire
names the volley it means, so a tap that lands after its volley has gone fires nothing.

`trace` runs one beam through the mirrors as they stand. `resolve` is what a volley does fired now:
the board previews with it (`outlook`) and the reducer scores with the same function. Events are
`deal` and `fire`, numbered with a rising `seq`.

Locks are `locked` in the state, one entry a cell: how many more volleys it is held. A fire runs
`lockAfter` (what was held drops by one, then the end of each beam's route is held for
`hotVolleys`), and the fire event carries the cells locked once it fired. `lockedCells` is what the
board asks. A flip on a locked mirror is refused with `mirror is locked`, checked against the grid
at the move's tick, so a flip that lands just after the volley that locked it fired is refused too.
The hash reads the locks only when they are on, so with `hotVolleys: 0` every hash is what it was
before locks (a test holds four seeds to their old scores and hashes).

The search (`volleyOptions`, `volleyRoute`) walks the beams in order and tries both settings of
each mirror the first time a beam meets it, so it visits each thing one grid can do once. A locked
mirror is set already, the way it stands, so the deal, the best and the hint all read it as fixed. It is in
a fixed order and stops after 40,000 mirror meetings. On the content grid a search spends a median of 95
meetings, and 915 at most over 3,000 sampled volleys. A reduce on the content config takes 0.03 ms
on average. A player who fires every volley the tick it is dealt (199 volleys) costs 6 ms for the
whole round. The budget is only reached on lab grids far from content (eight by eight with thirty
mirrors and three beams): a deal there costs about 5 ms and deals the best exits found so far.

## Tuning notes

Set from bots, not people (ADR 0036). The bots are the runner's (`packages/bots`, ADR 0067;
`pnpm --filter @openseas/bots ladder deflectors`), at a person's pace of 0.8 s a flip and 6 s a beam
to see the long way round. Every bot respects locks: none flips a locked mirror, and the search is
asked for the best with the locks as they stand.

The ladder, 32 seeds a cell (`ladder-0` to `ladder-31`), on the content file as committed:

| Bot | Route (60 s) | Pairs (90 s) | Long (120 s) | Full (120 s) |
|---|---|---|---|---|
| careless | 310 Steady | 204 Steady | 592 Steady | 447 Steady |
| one move (the bait under locks) | 1,564 Masterful | 1,924 Masterful | 3,905 Masterful | 3,882 Masterful |
| rollout | 1,588 Masterful | 2,032 Masterful | 3,973 Masterful | 4,622 Masterful |
| joiner | 596 Sharp | 807 Sharp | 1,282 Sharp | 1,940 Sharp |
| longest | 1,498 Masterful | 1,559 Masterful | 3,463 Masterful | 3,320 Masterful |
| lengthener (the bait for joining) | 231 Steady | 409 Steady | 624 Steady | 947 Steady |
| *Steady from* | *150* | *200* | *400* | *400* |
| *Sharp from* | *437* | *575* | *1,149* | *1,149* |
| *Masterful from* | *999* | *1,299* | *2,598* | *2,598* |
| *Legendary from* | *1,787* | *2,349* | *4,697* | *4,697* |

- **careless** takes any choice at random: a whole plan (the engine's best, the joined route), a
  single flip on a drawn line, firing now or waiting out the count. It is less careless than its
  name, because half its choices are whole plans.
- **one move** takes the choice worth most now; **rollout** tries the eight best, each played five
  decisions on three times on a fresh random stream (it never sees the next volley's ports).
- **joiner** joins each beam's line to the dots from its exit and fires once home: the rule the board
  teaches. **longest** is handed the search's best and pays only for the time to see it.
  **lengthener** is the joiner trying three flips for a longer route before it fires.

Locks on and off, the same bots on the whole puzzle (`--set hotVolleys=0` for off):

| Bot | Off, 32 seeds | Locks, 32 seeds | Off, 64 seeds | Locks, 64 seeds |
|---|---|---|---|---|
| one move | 3,905 | 3,882 | 3,687 | 3,726 |
| rollout | 3,973 | 4,622 | 3,907 | 4,354 |
| rollout over one move | +1.7% | +19.1% | +6.0% | +16.9% |
| joiner | 1,282 | 1,940 | | |
| longest | 3,463 | 3,320 | | |

- **Locks pay for planning and nothing else.** The bots that play one volley at a time (one move,
  longest) score the same or a little less with locks; only rollout, which looks past the volley in
  hand, gains. At 64 seeds the gap between them goes from 6 percent to 17. The pitch measured +22
  percent at 32 seeds on an earlier build; this build's 32-seed gap is 19.
- **The bait** is the best route every volley, which is the one-move bot under locks. It is named in
  `baits` against rollout, and loses by 16 percent at 32 seeds (14 at 64).
- **The joiner gains 51 percent from locks** (1,282 to 1,940). A locked mirror is one fewer for its
  rule to flip back and forth over, so it wastes fewer flips. That is why locks hold for one volley:
  at two the pitch had the joiner at 3,520, near the planners.
- **Off changes nothing.** With `hotVolleys: 0` every seed deals and scores as before locks; a test
  holds four seeds' scores and hashes to the engine before the change.

**Stage thresholds** are first guesses from this table, set so careless reads Steady, the joiner
Sharp and the one-move bot Masterful at each stage, with Legendary above every bot. `route` is the
whole puzzle's thresholds scaled by 0.38 (Steady from 150, Masterful from about 1,000), `pairs` by
0.5, and `long` keeps the whole puzzle's, since its bots score as the whole puzzle's do without
locks. The careless bot reads Steady on every stage and so would pass each one; it plays whole
plans half the time, and a person who taps at random would not. The whole puzzle's thresholds are
the owner's and were left alone: under locks the joiner moves up but stays Sharp, the one-move bot
stays Masterful and rollout sits just under Legendary (4,622 against 4,697). They do not need moving
on this evidence; whether Legendary should sit a little lower now that planning pays is the owner's
call once people have played it.

The choices behind the rest of the numbers. The first build's bots (sixty rounds, a hand-made
joiner) are gone; where a figure below is theirs it says so.

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
  or two flips away that is longer exists for about one mirror in twenty. The lengthener scores 624
  against the joiner's 1,282 with locks off (947 against 1,940 with them). The long route has to be
  seen, which the longest bot stands in for: at six seconds a beam it scores 2.7 times the joiner
  with locks off. This is the weakest part of the design; see the open questions.
- **`minBest` 4.** A volley is dealt exits worth at least a four-turn beam a beam, with a cheaper
  way home too, so every volley has a long way round to find. It came after the first build's
  table: that build's joiner scored 750, today's scores 1,282 on today's engine and bots.
- **`bouncePoints` 1, `bounceCap` 16.** Points are (turns + 1) squared; the cap is a guard for lab
  grids, and no content route comes near it.
- **No beam is dealt the exit it already runs to.** Otherwise about one beam in twelve is home
  untouched, and firing volleys as they come is worth a little for no thought.
- **The hint goes to the best setting, not the nearest.** A hint to the nearest clean setting and
  then to the best would send a player back and forth; towards the best, each flip is one fewer to
  go.
- **Thresholds.** 150, 400, 800, 1500, 2600 and 4000 for ratings 1100 to 2100, set on the first
  build's bots. On today's: careless Steady, the joiner Sharp, the one-move and longest bots
  Masterful, rollout just under Legendary (the table above).

## Open questions for play

- **Can a person see which mirrors to keep free?** This is the question locks stand or fall on. The
  rollout bot's 17 percent comes from trying routes and playing on with a fresh stream, which no
  person does in a 13 second count. If people play locks as a rule they can say ("do not end a
  route on the mirror at the middle of the loop"), the layer is a skill; if the gap only shows for
  the bot, it is a tax on the long way round and should come out, or hold for fewer turns.
- Does a locked mirror read at a glance on a phone, mid-count, beside the free ones?
- Is one volley the right length for a lock? Two volleys widened the bots' gap a little in the pitch
  (rollout 4,836) but lifted the joiner by more; one is the owner's pick.
- Does the refusal on a locked mirror feel like a rule or like the board ignoring a tap?
- Does careless play pass each stage? The careless bot reads Steady everywhere, but it plays whole
  plans half the time. Watch a new player's first rounds before raising the Steady line.
- Can a person learn to see the long route in the time a volley gives, or is the best only ever a
  number on the strip? If the second, the perfect bonus is dead and something nearer should pay.
- Does one grid for the whole round go stale, or is knowing it part of the skill?
- Is five more seconds enough for a second beam late in the round?
- Do the dots make the first skill too easy once the crossing rule is known?
- Three beams a volley is a lab preset. Is it a puzzle or a mess?
