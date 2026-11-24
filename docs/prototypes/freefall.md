# Freefall

Status: built. Prototype (ADR 0036, ADR 0081), in the studio at `/freefall`. Each drop has its own
30 second clock (`turnSeconds`); a round is four legs, with no clock of its own.

Freefall is a successor, not one of the game's own new designs: it follows the original's Treasure
Drop, the parlor game of dropping coins through a board of seesaws (DESIGN.md section 3 lists it as
explicitly later). It keeps that game's mechanics and gives everything a player sees and hears its
own form. Where it departs from the original is listed in DESIGN.md section 6.

## The puzzle

A salvage station drops its cargo down a shaft into the berths at its foot. The shaft is a tree,
as the original's board is: narrow at the top and wide at the foot. Pods are dropped down the
middle four lanes (`entry`); seven rows of rockers (`rows`) widen evenly from those four lanes to
eight at the foot (`width`), a berth under every one. The rockers lie in a brick pattern: an even
row's start at its left edge, an odd row's one lane in, so an odd row's outer lanes are open. The
deal flips each rocker to a side at random and leaves 6 places in a hundred open (`gapPermille`).
No lane drops straight onto the outer berths: a pod reaches them only by being turned outward by
rockers on the way.

- **The verb is a drop.** Pick one of the top lanes; a pod falls straight down it, a row at a time.
- **Rockers.** A rocker spans two lanes: its cradle on one side, its arm on the other.
  - Onto an empty cradle, a pod comes to rest. The rocker does not move.
  - Onto a full cradle, a pod rolls over to the arm side.
  - Past an arm, a pod falls on, and the rocker flips once for each pod that passes: the cradle and
    the arm change sides. A pod resting in a cradle that flips an odd number of times is tipped out
    and falls down its own lane; flipped an even number of times, it lands back.
- **Clusters.** Everything in motion falls in step, so pods that reach the same lane at the same
  row fuse into a cluster and fall as one. A cluster onto an empty cradle leaves one pod at rest and
  rolls the rest to the arm.
- **Berths.** A pod past the last row lands in the berth under its lane. A cluster of n in a berth
  worth v scores v × n × n (`squareClusters`; off, v × n).
- **Legs.** A round is four legs. Each has a quota (`quotas`) and its own berth values (`bays`,
  listed from the middle lane outward and mirrored): flat 2 in the first, 1 rising to 12 at the
  edge in the second, 1 to 8 in the third, 1 to 20 in the fourth. Pods at rest stay from one leg to the
  next.
- **The rival.** Points go to whoever dropped the pod that set them off. A rival drops after every
  drop of the player's (`rival`), from the round's own seeded stream: the drop worth most at once 70
  times in a hundred (`rivalSkill`), a top lane at random otherwise. When either side's points in a leg
  reach its quota, the other drops once more and the leg ends. With no rival, a leg ends at the
  quota.
- **The score is the lead**: the player's points less the rival's, never below zero. With no rival
  it is the player's points.

The compound move the puzzle pays most for: **a cluster landed in a rich berth**, two loaded
cradles tipped so their pods meet in one lane, ideally saved for the fourth leg's edges.

## Luck and skill

- **Luck:** the deal of the shaft (rocker sides, open places), and the rival's random drops. The
  shaft is in full view and every fall is worked out exactly: the strip shows what a drop pays.
- **First skill:** reading a fall: which drops rest and which tip a full cradle into the berths.
- **Second skill:** the edges. From the second leg the outer berths pay up to eight times the
  middle.
- **Third skill:** denial. The rival drops next, so a pod left at rest over a rich lane is the
  rival's. Weighing a drop by its points less the best drop it leaves is the step from Steady to
  Sharp.
- **Fourth skill:** clusters: two falls that meet in one lane, and even flips that pass a full
  cradle without spilling it.
- **Fifth skill:** the legs. Rest pods late in a leg the rival will win anyway, and tip them on the
  rich legs.

## The ladder

Not yet laddered (ADR 0066). The rival is the layer a first stage would switch off (`rival: false`,
the Solo preset), but on its own the solo shaft does not yet ask for skill: the bots below play it
no better than at random. A first stage wants a solo rule that pays for planning.

## Input and feedback

- Pointer: tap anywhere down one of the top lanes (each marked by a dot over the shaft) to drop a pod down it; a tap outside them drops nothing. On desktop a hover picks the lane, and
  the strip over the shaft says what a drop down it pays (`freefallDropValue`), or that it only
  rests.
- Keyboard: left and right, or A and D, move the lane in hand among the top lanes (an amber chevron); space or enter
  drops.
- Unrated and lab rounds frame the lane worth most at once after six seconds idle (`freefallHint`).

The board follows the brand book (`docs/BRAND.md`, ADR 0061, ADR 0062): it draws its pieces in code
(`boards/src/freefall/pieces.ts`) from `boards/data/pieces/freefall.json`, and loads no image.

- **A pod** is an upright capsule with its porthole cut out, in sand. A cluster carries its count on
  it in mono.
- **A rocker** is one seesaw across its two lanes, slate: **a cradle** is an open cup with the beam
  rising from it, **an arm** the rest of the beam on its pivot post, up to a knob. The two are
  drawn edge to edge, so the beam runs unbroken from cup to knob, with the cup low and the arm
  raised for a pod to strike.
- **A berth** is a tray open at the top, dim, with its value in cream mono.
- **The board.** Bare ground, no frame and no grid. The one hairline is the line over the berths,
  where a fall ends and is paid.
- **A drop** falls a row every 130 ms, slow enough to follow a pod down and see what it tips. A
  pod coming to rest pops a step higher each row down. A rocker that flips swings on its pivot
  with the thud: level, then down the other way, the arm side dropping where the cup was. What lands shrinks into its berth with its points in cream, the ping
  higher the more the berth pays and the multi for a cluster.
- **The rival's drop** follows: its pod appears in a rose ring with a whoosh, and its points rise in
  rose.
- **Callouts**, one a drop: a cluster, then four pods or more; the rival's points; who took the leg.
- **The beat** is kept for one thing: a cluster of three or more of the player's.

## Engine

`packages/engine/src/freefall/`. Moves: `{ type: "drop", lane }` and `{ type: "end" }`. A move's
report holds the player's drop and the rival's, each with every row of its fall (what arrived,
what rested, what flipped and how often, what was tipped), what landed and scored, and the shaft
after.

## Tuning notes

Set from bots, not people (ADR 0036). A person's pace is modelled as a drop every 3 seconds, the
rival's answer played out included. A round is a few dozen drops (under fifty in 200 seeds of random or greedy play), so the legs end it.

- **A clock on each drop, not on the round** (the owner's call). Each drop has 30 seconds
  (`turnSeconds`, which the reducer never reads); when they run out the board drops down the lane
  in hand, as space would, with a tick for each of the last five seconds. The round's own clock
  (`roundSeconds`) is only a cap, 60 drops (`maxMoves`) of a whole turn each, which content checks
  it covers. The pace indicator reads a stretch of play as a 150 second round of brisk play, the
  round the bots' ladder plays.

- **The score is the lead, not the points.** A leg ends at its quota, so a player's own points sit
  near the quotas' sum however well they play: the bots' points sit close together.
  Read as the lead, the denier scores 147, one move 114 and careless play about zero.
- **Clusters pay n × n.** The original pays a multi-coin its slot times its count; squaring is what
  makes planning a cluster worth more than two lucky singles (rule 13).
- **The rival at 70.** Sharp enough that a pod left at rest over a rich lane is usually taken, loose
  enough to leave openings.
- **Thresholds** sit so that random drops and the edge chaser are Green, the one-move player is
  Steady and the bots that read the rival are Sharp. Masterful and Legendary are left for play no
  bot here reaches.

The bots of this pass, 32 seeds (`pnpm --filter @openseas/bots ladder freefall`):

| Bot | Full |
|---|---|
| careless | 1 Green |
| one move | 114 Steady |
| rollout | 166 Sharp |
| denier | 147 Sharp |
| edge chaser | 11 Green |
| *Steady from* | *55* |
| *Sharp from* | *135* |
| *Masterful from* | *210* |
| *Legendary from* | *308* |

- **careless**: any top lane at random.
- **one move**: the drop worth most now.
- **rollout**: the eight best drops, each played five drops on, three times, on a fresh random stream.
- **denier**: points now less the best drop it leaves the rival.
- **edge chaser** (a bait): always the top lane over the richest berth it can reach straight down.

Checks: careless lands a tier below one move; the edge chaser loses to one move; and one move,
the plain greedy play that looks right, loses to the denier by 22 percent.

Open questions for play:

- **Clusters are rare.** The bots' largest cluster averages under two a round, so the named compound
  move is seldom seen; a bot that plans clusters, or people, will say whether it can be set up on
  purpose often enough.
- **A score of zero most of a leg.** The lead sits at zero whenever the rival is ahead, which may
  read as nothing happening. The HUD shows both sides' points in the leg.
- **No ladder yet**, as above.
- **The pace.** A drop every 3 seconds is a guess.
