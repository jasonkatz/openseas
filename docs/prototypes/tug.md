# Tug

Status: built. Prototype (ADR 0036), in the studio at `/tug`. Untimed moves; a 120 second round.

## The puzzle

A cargo bay in zero gravity, seven by seven, with five fixed blocks in it (`blocks`) and four cargo
pods (`pods`), each its own shape. Nothing stops by itself here: a pod that is flicked slides in a
straight line until a wall, a block or another pod stops it. A flick that would move nothing is not
a move.

One clamp is lit on the floor, drawn as the outline of the pod it wants. Bring that pod to rest
on the clamp and it is delivered. Sliding over the clamp does not count: the pod has to stop there,
so the work is finding something to stop against, and when nothing stands in the right place,
flicking another pod there first. A delivered pod stays where it is, and another clamp lights for
some pod somewhere else.

Every clamp has a par: the fewest flicks that can deliver it from the bay as it stood when it lit.
The engine works it out by searching every bay those flicks can reach, so a clamp can always be
delivered and par is exact. A delivery is graded against it:

- **Clean**, at par: the clamp's worth doubled (`cleanPercent`).
- **Full**, within two flicks of par (`slack`): the clamp's worth.
- **Slow**, anything later: half of it (`slowPercent`).

A clamp is worth 10, 25, 50 or 90 by its par of one to four (`parPoints`). Clean deliveries in a row
build a streak that multiplies a clean delivery by 100, 115, 130, 145, 160, 180, then 200 percent
(`streakPercent`). A full or slow delivery ends the streak, and so does a skip.

The clamps follow the player. The first is par two (`startPar`). Every two clean deliveries
(`cleanPerStep`) raise the par of the clamps to come by one, up to four (`maxPar`); a slow delivery
or a skip takes one clean delivery back. A full delivery changes nothing. So a player who is seeing
the routes is given harder clamps worth more, and one who is not is eased back to clamps they can
read.

A clamp that has gone wrong can be skipped for 15 points (`skipPenalty`, never more than the score
holds) and the streak. Another lights, never the same one.

## Luck and skill

- **Luck:** where the next clamp lights and for which pod. Nothing else: the blocks are fixed for
  the round and the pods are wherever the player left them.
- **First skill:** seeing where a pod will stop, and putting two flicks of one pod together.
- **Second skill:** the stop that is not there yet. About three in four par-three routes and nine in
  ten par-four routes need a second pod flicked into place before the cargo moves.
- **Third skill:** reading a par-four route at a glance and keeping the streak through them, and
  leaving the bay in a shape that suits the next clamp, since the bay left behind is the bay the
  next clamp is dealt on.

## Input and feedback

- Pointer: swipe starting on a pod to flick it that way; the flick goes as soon as the swipe has a
  direction. A pod is picked up from anywhere within three quarters of a cell of its centre. With a
  pod picked, a swipe anywhere flicks it, and a tap on a cell in its row or column flicks it toward
  that cell. The skip button is in the strip over the bay.
- Keyboard: 1 to 4 pick a pod and space picks the next; arrows or WASD flick the picked pod; X or
  backspace skips; escape lets go.
- The picked pod shows where each of its four flicks would carry it (`tugSlide`). It looks one flick
  ahead and no further, in every round. When a clamp lights, the pod it wants is picked.
- Unrated and lab rounds show the first flick of a par route after seven seconds idle (`tugSolve`):
  a cream arrow from the pod to where it would stop. When the clamp is more than four flicks away
  the skip button is edged in cream instead.

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
  in mono, and the skip button, a raised button with cream text.
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
- **The beat**, one amber pulse of the whole board, is kept for two things: a clean delivery at par
  four, the long route read whole, and a streak brought to its top. There is no shake, no flash
  and no glow.

## Engine

`packages/engine/src/tug/`. Moves: `{ type: "flick", pod, dir }` (0 up, 1 right, 2 down, 3 left),
`{ type: "skip" }` and `{ type: "end" }`. A move's report gives the slide (pod, from, to, what
stopped it), the delivery (flicks, par, grade, streak, points) or the skip, and the clamp that lit.

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

## Open questions for play

- Do the ghosts give too much away at par two, where the delivering flick is often one of the four
  shown after the first flick? They could be a practice-only aid like the hint.
- Is a strict streak right, or should one full delivery be forgiven as Salvage forgives a short
  line?
- Seven in ten clamps light against a wall, because walls are where pods stop. Clamps in the open
  are the more interesting ones; the deal could favour them.
- Is par four fun at speed, or is it where a round stalls? If it stalls, `maxPar` three with more
  pods may be the better top end.
