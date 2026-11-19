# Tug

Status: built, and deepened in M11 with pairs and a ladder of four stages (ADR 0066). Prototype
(ADR 0036), in the studio at `/tug`. Untimed moves; a 120 second round.

## The puzzle

A cargo bay in zero gravity, seven by seven, with five fixed blocks in it (`blocks`) and four cargo
pods (`pods`), each its own shape. Nothing stops by itself here: a pod that is flicked slides in a
straight line until a wall, a block or another pod stops it. A flick that would move nothing is not
a move.

Two clamps are lit on the floor, each drawn as the outline of the pod it wants, and each for a
different pod (`clamps`). Bring a pod to rest on its own clamp and it is delivered. Sliding over a
clamp does not count: the pod has to stop there, so the work is finding something to stop against,
and when nothing stands in the right place, flicking another pod there first. A delivered pod
stays where it is, and a new clamp lights in its place, for a pod the other clamp does not want and
never on the other's cell (it may be the pod just delivered).

Every clamp has a par: the fewest flicks that can deliver it from the bay as it stood when it lit.
The engine works it out by searching every bay those flicks can reach, so a clamp can always be
delivered and par is exact. **Pairs:** when one clamp is delivered, the other is measured again from
the bay the delivery leaves. Its par becomes the fewest flicks from there, its flicks count from
there (the counter is shared and starts again at every delivery), and it keeps the **worth** of the
par it lit at. So a delivery can bring the other clamp closer, and a clamp that lit at par four
may then be a flick away and still pay as a par four: that is the handoff. It can also push it
further: a clamp is measured as deep as `maxPar` plus two (six), and one pushed further than that
is graded as though it were six away. A delivery is graded against its par:

- **Clean**, at par: the clamp's worth doubled (`cleanPercent`).
- **Full**, within two flicks of par (`slack`): the clamp's worth.
- **Slow**, anything later: half of it (`slowPercent`).

A clamp is worth 10, 25, 50 or 90 by the par of one to four it lit at (`parPoints`). Clean deliveries in a row
build a streak that multiplies a clean delivery by 100, 115, 130, 145, 160, 180, then 200 percent
(`streakPercent`). A full or slow delivery ends the streak, and so does a skip.

The clamps follow the player. The first is par two (`startPar`). Every two clean deliveries
(`cleanPerStep`) raise the par of the clamps to come by one, up to four (`maxPar`); a slow delivery
or a skip takes one clean delivery back. A full delivery changes nothing. So a player who is seeing
the routes is given harder clamps worth more, and one who is not is eased back to clamps they can
read.

A skip gives up both lit clamps for 15 points (`skipPenalty`, never more than the score holds) and
the streak. Two new ones light, neither the same as either. A skip gives up both, not one, because
the counter is shared: skipping one alone would start the other's flicks again for 15 points, and
launder a slow delivery into a clean one at its full worth.

With `clamps: 1` (off) one clamp is lit at a time, and a seed deals and plays exactly as it did
before pairs, hash and all.

## Luck and skill

- **Luck:** where the next clamp lights and for which pod. Nothing else: the blocks are fixed for
  the round and the pods are wherever the player left them.
- **First skill:** seeing where a pod will stop, and putting two flicks of one pod together.
- **Second skill:** the stop that is not there yet. About three in four par-three routes and nine in
  ten par-four routes need a second pod flicked into place before the cargo moves.
- **Third skill:** reading a par-four route at a glance and keeping the streak through them, and
  leaving the bay in a shape that suits the next clamp, since the bay left behind is the bay the
  next clamp is dealt on.
- **Fourth skill (pairs):** two clamps to choose between. First, take the nearer: the bot that
  does scores 12 percent more than one that plays out the clamp it began. Then the handoff:
  deliver one so the pod it leaves is the stop the other needs, and the other comes closer and
  still pays as it lit. The bot that plans both clamps as one scores 4 percent more than the one
  that takes the nearer, and makes a handoff 3.6 times a round to its 2.6.

The compound move is **the handoff**: one delivery that sets up the other clamp, so a clamp that
lit at a high par is delivered in a flick or two for its full worth.

## The ladder

A new player climbs four stages (ADR 0066), each passed with one Steady round. Only the whole
puzzle counts. Every stage is the whole puzzle with layers switched off in `stages` in the content
file; the names and one-line cards are `tug.stage.<id>` and `_intro`.

| Stage | Round | What is on | Switched off |
|---|---|---|---|
| Glide (`glide`) | 60 s | Clamps of par one and two (`startPar: 1`, `maxPar: 2`), the grades | The streak (`streakPercent: [100]`), pairs (`clamps: 1`), par three and four |
| Stops (`stops`) | 90 s | Par three (`maxPar: 3`): the stop that is not there yet, and the streak | Pairs, par four |
| Pairs (`pairs`) | 120 s | Two clamps and the handoff, par up to three | Par four |
| Full bay (`full`) | 120 s | Everything, par up to four | |

The stage thresholds are first guesses from the bots (see the tuning notes), set by one rule read
off the whole puzzle's thresholds as the bots score them before pairs: Steady from 0.7 of the
novice bot, Sharp from 0.9 of the steady bot, Legendary from 0.72 of the best bot, and Masterful
between. Glide is the exception: every bot that reads a par-two route plays it perfectly, so all of
them score the same (740 at the modelled pace) and the tiers there can only read speed: Steady from
150, above the ghost reader, and Legendary from 900, a quicker hand than the model's.

## Input and feedback

- Pointer: swipe starting on a pod to flick it that way; the flick goes as soon as the swipe has a
  direction. A pod is picked up from anywhere within three quarters of a cell of its centre. With a
  pod picked, a swipe anywhere flicks it, and a tap on a cell in its row or column flicks it toward
  that cell. The skip button is in the strip over the bay.
- Keyboard: 1 to 4 pick a pod and space picks the next; arrows or WASD flick the picked pod; X or
  backspace skips; escape lets go.
- The picked pod shows where each of its four flicks would carry it (`tugSlide`). It looks one flick
  ahead and no further, in every round. When a clamp lights, the pod it wants is picked; with pairs,
  after a delivery, the pod of the nearer clamp is (the one left lit on a tie).
- Unrated and lab rounds show the first flick of a par route to the nearer lit clamp after seven
  seconds idle (`tugHint`): a cream arrow from the pod to where it would stop. When both clamps are
  more than four flicks away the skip button is edged in cream instead.

The board is restyled to the brand book (`docs/BRAND.md`, ADR 0061, ADR 0062): it draws its pieces
in code (`boards/src/tug/pieces.ts`), loads no atlas and has no marks setting.

- **Pods.** The bay is seen from above, and each pod is one flat piece of cargo with an outline of
  its own: the drum a disc, the crate a square, the wedge a triangle, the prism a diamond, and the
  cell (the fifth pod, in a lab bay) a capsule. Their colours are a second cue: sand, sky, rose,
  moss and lilac.
- **The clamp** is the socket its pod drops into: the pod's own outline a size larger, in the pod's
  colour, with the pod's shape cut out of it. So a clamp is its pod's partner with the colour taken
  away, a pod is solid and a clamp is hollow, and the rim still shows round another pod that has
  stopped on it.
- **A block** is a girder stub seen end on, in slate: two flanges and a web, an outline no pod has.
- **The board.** Bare ground. The one hairline is the bay's walls, because a wall is a stop. No
  frame and no grid; a small dot marks every cell, since where a slide ends is the whole game.
- **The strip** over the bay shows the wanted pod, then the clamp's par and the flicks spent on it
  in mono, and the skip button, a raised button with cream text. With pairs it has a slot for each
  lit clamp: the wanted pod as its own silhouette and its par in mono, with "as par N" under it in
  `dim` when it pays as another par; then the flicks, and the skip button. A clamp keeps its slot
  until it is delivered. The two clamps want two pods, so they are two outlines and two strip
  pictures: they are told apart without colour.
- **The picked pod** is ringed in amber: it is the player's own. The dots of the cells each flick
  would cross light up, and a small copy of the pod sits where it would stop. The flick that
  delivers lights its dots in cream and its copy sits inside the clamp.
- **A flick** slides the pod at a pace set by how far it goes (the length is the rule), eased, and
  it stops dead: no squash, no trail, no puff. A flick into something the pod already rests
  against leans the pod and brings it back.
- **A delivery** shrinks the clamp to nothing. The points rise from the pod in cream, with the
  flicks against par under them, and the grade is called out: cream for clean and full, dim for
  slow. A skip is said in danger with its penalty. The next clamp grows onto its cell, and calls
  out its par when that differs from the last.
- **A handoff** (pairs): when a delivery brings the other clamp closer, "Handoff: par N" rises over
  it in cream (under it on the top row) and the clamp's ping plays at its new par; its slot in the
  strip shows the new par and the par it pays as. A delivery that pushes the other further shows
  its new par over it in `dim`, quietly. Both cues are the board's own (`ping`); nothing new.
- **The beat**, one amber pulse of the whole board, is kept for two things: a clean delivery at par
  four or one that pays as par four, the long route read whole, and a streak brought to its top. There is no shake, no flash
  and no glow.

## Engine

`packages/engine/src/tug/`. Moves: `{ type: "flick", pod, dir }` (0 up, 1 right, 2 down, 3 left),
`{ type: "skip" }` and `{ type: "end" }`. A move's report gives the slide (pod, from, to, what
stopped it), the delivery (flicks, par, worth, grade, streak, points) or the skip (both clamps
given up with pairs), the clamp that lit (and a skip's second), and with pairs `kept`: the clamp a
delivery left lit, measured again, its new par and its worth.

The state holds the lit clamp (`clamp`, the one lit longer) and with pairs the other (`clamp2`),
each with its pod, cell, par and worth. With `clamps: 1`, `clamp2` is null, the worth is always
the par, neither is hashed, and the second clamp is never dealt, so a seed hashes as before pairs
(a test pins three seeds' openings and play). With pairs the second clamp is dealt after the
first, from the same stream, so turning the layer on changes nothing dealt before it. The board's
queries are `tugLitClamps`, `tugClampDelivered` and `tugHint` (the shortest route to the nearer
clamp); `tugSolve` takes the clamp to solve for. The view string names a second clamp after the
first.

A clamp is dealt by one breadth-first search from the bay as it stands, to the depth of the par
wanted, over every bay those flicks can reach. It records, for every pod and cell, the fewest flicks
after which that pod can rest there. The clamp is drawn evenly from the pairs whose fewest is
exactly the par wanted, on an empty cell. If no pair needs that many flicks the next lower par is
dealt. Pods and directions are tried in a fixed order, so the server and the client deal the same
clamp. `tugSolve` is the same search with its route kept, for the hint and for tests.

`maxPar` is held to four by the validator: the search grows sixteenfold a flick.

## Tuning notes

Set from bots and a model of players, not from people (ADR 0036).

- **The search is cheap.** Dealing a clamp at par four on the content bay took 0.14 ms on average
  over 1,480 deals and 16 ms at worst (a cold start); at par two and three it is under 0.1 ms. A
  test checks the par against a plain exhaustive search at every depth.
- **One search, not a random walk.** The brief dealt a clamp by playing random flicks on a copy and
  retrying until the par came out right. Searching once and drawing from the exact pairs is
  quicker, never retries, and gives every clamp of that par an even chance. In 1,600 deals it never
  had to fall back to a lower par.
- **Clamps follow the player, not a schedule.** The brief raised the par with the count of
  deliveries. That leaves a player who cannot see par-three routes stuck on par four for the rest of
  the round, delivering slowly for half points. Raising it on clean deliveries and lowering it on
  slow ones keeps each player at the edge of what they can read, and a higher par is still worth
  more, so it does not flatten scores.
- **Five blocks, off the walls, never touching.** Blocks on the walls add little (the wall is
  already a stop), and blocks that touch can wall a cell in. With no blocks at all, 93 percent of
  par-three routes need a second pod, which is hard on a newcomer. From three blocks to seven the
  share settles near 70 percent at par three and 90 at par four, so within that range the count was
  chosen for looks: enough stops in the middle to read, with open lanes left. Five do not always fit when picked at random, so the layout is tried again up to
  twelve times.
- **Flailing does not pay.** A bot flicking at random delivers under one clamp in 60 flicks. One
  that takes a delivering flick when it sees one and otherwise favours the wanted pod delivers
  four. One that plays par routes delivers sixteen. The ghosts exist because of the first number:
  a new player needs to see one flick ahead to begin at all.
- **Thresholds** come from four modelled players, each with odds of seeing the par route by par and
  seconds a clamp takes, over 200 rounds: a novice (par two nearly always, par three under half the
  time) scores about 360, a steady player 660, a good one 1,040 and an expert 1,960 with a best
  tenth near 2,700. A machine that never thinks scores 5,670. The thresholds are 200, 400, 700,
  1,100, 1,800 and 2,800.

### M11: pairs and the ladder

Set from the bot runner (`packages/bots`, ADR 0067; `pnpm --filter @openseas/bots ladder tug`), 32
seeds a cell (`ladder-0` to `ladder-31`), a person's pace modelled as 60 flicks in 120 s. Each cell
is the mean score and the tier it reads as against that stage's thresholds. The bots are the notes'
bots above, rebuilt in the runner and taught to see two clamps (the ghost reader takes a delivering
flick for either; the novice and steady models read the nearer clamp), with five more: two flicks
(the plain bot), the finisher (the bait), nearest first, the pair planner, and the drift waiter.

| Bot | Glide (60 s) | Stops (90 s) | Pairs (120 s) | Full (120 s) |
|---|---|---|---|---|
| careless | 8 Green | 3 Green | 10 Green | 10 Green |
| one move | 69 Green | 31 Green | 73 Green | 73 Green |
| rollout | 141 Green | 765 Steady | 1,496 Steady | 1,233 Sharp |
| ghost reader | 98 Green | 45 Green | 146 Green | 149 Green |
| two flicks | 740 Masterful | 322 Green | 602 Green | 498 Steady |
| novice | 703 Masterful | 683 Steady | 999 Steady | 644 Steady |
| steady | 697 Masterful | 1,241 Sharp | 1,755 Sharp | 1,196 Sharp |
| finisher (the bait) | 740 Masterful | 2,522 Legendary | 3,079 Legendary | 4,305 Legendary |
| nearest first | 740 Masterful | 2,522 Legendary | 3,699 Legendary | 4,829 Legendary |
| pair planner | 740 Masterful | 2,522 Legendary | 3,825 Legendary | 5,010 Legendary |
| drift waiter | 740 Masterful | 2,522 Legendary | 3,695 Legendary | 4,794 Legendary |
| *Steady from* | *150* | *480* | *700* | *400* |
| *Sharp from* | *400* | *1,100* | *1,559* | *899* |
| *Masterful from* | *650* | *1,400* | *2,100* | *1,799* |
| *Legendary from* | *905* | *1,805* | *2,744* | *3,298* |

- **two flicks**: plays any route of two flicks or fewer to a lit clamp, else plays as the ghost
  reader. **finisher**: the par route to the clamp lit longest, never looking at the other (with one
  clamp, the notes' machine that never thinks). **nearest first**: the par route to the nearer
  clamp, every flick (the idle hint). **pair planner**: the fewest flicks that deliver both lit
  clamps, the first within its par, so the first delivery is left as the second's stop where that is
  shorter; it plans again when a clamp lights. **drift waiter**: delivers the clamp worth less, over
  and over, until the one worth more has drifted to a flick away.

The checks: careless lands a tier below plain play on glide (8 against 740) and on the whole puzzle
(10 against 498, and 11 against 495 at 128 seeds), and **is broken on stops** (careless 3 and two
flicks 322, both Green) **and on pairs** (10 and 602, both Green). Both baits are met on the whole
puzzle: the finisher loses to nearest first by 10.9 percent and to the pair planner by 14.1.

- **The runner's plain bot.** In Tug no single flick pays: nothing scores until a pod is delivered,
  so the one-move bot (73) is barely above careless and was never plain thinking play. The runner
  now lets a game name the bot the careless check reads (`plain` in its `BotGame`), and Tug names
  two flicks. It reads met on the whole puzzle and on glide. On stops and pairs, whose clamps climb
  to par three, a bot that sees two flicks ahead spends most of the round on par-three clamps it
  cannot read, and lands under Steady. That is broken, and it is not tuned around: the stage
  thresholds are set by the one rule in The ladder, and moving Steady under 322 on stops would put
  the novice model two tiers up. Whether plain play on a par-three stage is "sees two flicks" or
  "sees par three half the time" (the novice, who lands Steady on both) is the owner's call.
- **The layer pays for skill.** With pairs off (`clamps: 1`) the whole puzzle scores as before:
  careless 2, one move 36, rollout 765, two flicks 369, novice 575, steady 1,007, and every
  par-route bot 4,594. With pairs on: rollout 1,233 (+61 percent, the pitch's 72), two flicks 498
  (+35), steady 1,196 (+19), nearest first 4,829 (+5), the pair planner 5,010 (+9), and the
  finisher 4,305 (−6). For a player who misses routes, a second clamp is a second chance to see
  one; for one who sees every route, the gain is choosing between them and the handoff.
- **The handoff is real but small for bots.** The pair planner beats nearest first by 3.7 percent
  (the pitch's 2.4) and makes 3.6 handoffs a round (a delivery at a par under its worth) to its
  2.6. Most of the layer's gain is seeing both clamps and taking the nearer, a real but simpler
  skill.
- **The bait.** Finishing what you started, the finisher, loses 10.9 percent to nearest first and
  14.1 to the planner, against the pitch's 37. The pitch's bot gave a clamp up whenever it had
  drifted past four flicks; this one plays it out at its measured par (up to six), which is what a
  player finishing the clamp they began does. It delivers 4.8 clamps a round at a par above their
  worth, to the planner's 0.6.
- **No degenerate play in keeping the worth.** The pitch worried that keeping the worth would pay a
  player to wait for a valuable clamp to drift close. The drift waiter tries exactly that and
  scores 4,794, level with nearest first and under the planner. Waiting costs flicks, and the
  other clamp's deliveries push the valuable one away about as often as they bring it closer.
- **Rule 14.** The worth a clamp keeps is 12 percent of the planner's score (622 of 5,010, net of
  the deliveries that paid less than their par), 7 percent of nearest first's.
- **Clamps pushed far away.** Nearest first leaves 7.3 clamps a round pushed past par four by the
  other's delivery, the planner 4.2. The engine measures a kept clamp as deep as par six (a
  search of under 25 ms at worst, with five pods); about one kept clamp in ten, in a sample of 60
  rounds of hint play, was further than six, and is graded as six. Skip is the way out.
- **The whole puzzle's thresholds are the owner's and are not moved here.** By the same rule as the
  stages, pairs on would put Steady from about 450 (0.7 of the novice's 644), Sharp from about 1,060
  and Legendary from about 3,600 (0.72 of the planner's 5,010). The bottom holds; the top wants
  raising, toward the pitch's guess of 4,000, if Legendary is to stay rarer than reading every
  route. That is for the owner in the studio, with a person's rounds.

## Open questions for play

- Do the ghosts give too much away at par two, where the delivering flick is often one of the four
  shown after the first flick? They could be a practice-only aid like the hint.
- Is a strict streak right, or should one full delivery be forgiven as Salvage forgives a short
  line?
- Seven in ten clamps light against a wall, because walls are where pods stop. Clamps in the open
  are the more interesting ones; the deal could favour them.
- Is par four fun at speed, or is it where a round stalls? If it stalls, `maxPar` three with more
  pods may be the better top end.
- Can a person read two clamps, two pars and the par a clamp pays as in the strip on a phone,
  and do they see the handoff before the callout tells them?
- A clamp pushed past par four reads "Par 6, as par 2". Is that news a player can use, or noise
  that wants a skip hint sooner?
- Is skipping both clamps at once right, or would a person want to skip only the hard one (which
  needs its own flick counter, so the other keeps its count)?
- The careless check is broken on stops and pairs with two flicks as plain play. Is the plain
  player of a par-three stage the two-flick reader, or the novice?
