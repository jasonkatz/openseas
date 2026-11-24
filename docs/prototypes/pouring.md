# Pouring

Status: built. Prototype (ADR 0036, ADR 0083), in the studio at `/pouring`. Untimed moves; a round
is 20 turns each, with a 300 second clock behind it that a round at a person's pace never reaches.

Pouring is a successor, not one of the game's own new designs: it follows the original's Drinking,
a tavern game a few pirates play around one board (DESIGN.md section 3 lists the parlor games as
explicitly later). It keeps that puzzle's mechanics and gives everything a player sees and hears
its own form. Where it departs from the original is listed in DESIGN.md section 6.

## The puzzle

A dockside bar at the edge of the reach: one bar top, six squares a side, and a few pirates round it
taking turns. The player is one of them; the rivals are the engine's (ADR 0083).

- **Drinks.** Every drink is a glass and a brew: four glasses (tumbler, flute, mug, coupe) and four
  brews (fizz, halo, ribbon, spark), every pairing once in a shuffled bag, with two ice and two rags.
  A bag that runs out is shuffled again.
- **The verb is a pour.** Each pirate holds two drinks. On a turn they set one down on an empty
  square where it **suits every drink beside it**, up, down, left and right: each neighbour shares
  its glass or its brew. Diagonals do not count. The slot is dealt again from the bag.
- **Served.** A row or a column that fills is served: whoever poured its last drink scores it, and
  every drink in it is taken off the bar. Lines served by one pour count together: k lines score
  `linePoints` × k × k, 100 for one and 400 for a row and a column at once.
- **Rings.** A drink leaves its pirate's ring on its square for good, cleared or not. A square no
  drink has stood on is **clean**. The first ring on a clean square scores `ringPoints` (20), and
  lines served by a pour onto a clean square are worth `cleanPercent` (200 percent): 200 for one, 800
  for the **clean double**.
- **A drink's value.** Every drink scores `pourPoints` (5) as it is poured, and `agePoints` (5) more
  for each turn it has waited in the hand, up to `ageMax` (4) turns.
- **Downing one.** Instead of pouring, a pirate may down a drink from their hand: it scores its
  value and puts nothing on the bar, so it gives the next pirate nothing. Every `tolerance` (3)
  drinks without `soberAfter` (3) pours between them put the pirate out cold, and their next turn is
  lost. A pirate with nothing that fits anywhere must drink.
- **Ice and rags.** Ice sets down on any empty square, and anything suits ice. A rag wipes one drink
  off the bar (its ring stays) and scores nothing. A rag with nothing to wipe is tossed.
- **Rivals.** Two rivals take their turns after the player's, one after another, and their hands
  are on show over the bar. On `rivalSkill` (70) percent of its turns a rival takes the pour a
  careful rating likes best: its points now, less 60 percent of a line for every gap it leaves that
  the pirate after it could fill. On the rest it pours anything that fits. A rival wipes only on a
  careful turn, to take a gap away from the pirate after it, and drinks only when nothing fits.
- **Last call.** The round ends when every pirate has taken `lastCall` (20) turns. The score is the
  player's own points; the result card says where they placed among the pirates.

The compound move it pays for is the **clean double**: a row and a column, both one short, crossing
on a square that is clean and empty, served by one pour for 800, more than four lines served one at
a time on rung squares.

## Role

None yet. It could take a role as a game between pirates at an outpost's bar, where a tier might
pay into a pirate's standing or a small purse; that is decided with the parlor games, on promotion.

## Luck and skill

Luck: the bag's order, which deals each hand; the rivals' coin for a careful or a careless turn.
The bag holds every pairing once, so no drink is missing for long, and every hand at the bar is on
show, so what the next pirate can do is never hidden.

Skill, in the order a player learns it, each paying clearly more than the last (the bots in the
tuning notes):

1. **Pour where it fits, and serve what you can.** Read glass and brew; take a line one short when a
   drink in hand suits its gap. (The one-move bot.)
2. **Hand nothing over.** A line left one short is served by the next pirate if their hand suits the
   gap: read their hand, keep lines two short, and down a drink when every pour would give a line
   away. (The careful bot, about a tier over one move.)
3. **Serve on clean squares.** Save a clean square to be the last drink of a line, for double. Clean
   squares run out as the bar is rung.
4. **Build the cross.** Bring a row and a column to one short round a clean empty square only when
   the drink that closes it is in your hand, and serve both at once. With the gaps' neighbours chosen
   so the gap wants your drink, not a rival's. Rare even for the rollout bot.

## The ladder

A new player climbs two stages (ADR 0066), each passed with one Steady round. Only the whole puzzle
counts. Each stage is the whole puzzle with layers switched off in `stages` in the content file;
its name and one-line card are `pouring.stage.<id>` and `_intro`.

| Stage | Round | What is on | Switched off |
|---|---|---|---|
| Lines | 20 turns | Pours, lines served, rivals, drinking | Clean squares (`ringPoints` 0, `cleanPercent` 100), ageing (`agePoints` 0), ice and rags (`icePerBag`, `ragsPerBag` 0) |
| Clean squares | 20 turns | Clean squares and rings | Ageing, ice and rags |
| Full bar | 20 turns | Everything | |

## Input and feedback

- Pointer: tap a drink in your hand to pick it (an amber frame), tap a square to pour it. The squares
  the picked drink suits carry a cream dot; the others a dim one. With a rag picked, the drinks it
  can wipe are circled. Tap the picked drink again to down it; the line under the bar says what that
  would score.
- Keyboard: 1, 2 and 3 pick a drink; arrows or WASD move an amber cursor on the bar; space or enter
  pours; X downs the picked drink. With the cursor in use the line under the bar says what the pour
  would score and how many lines it serves (`pouringPourValue`), or that the drink does not suit.
- Unrated and lab rounds ring a pour worth making after six seconds idle, its drink and its square
  in cream: the careful rating's best (`pouringHint`).

The board follows the brand book (`docs/BRAND.md`, ADR 0061, ADR 0062): it draws its pieces in code
(`boards/src/pouring/pieces.ts`) from `boards/data/pieces/pouring.json`, and loads no image.

- **Glasses** are outlines, each its own: the tumbler a tapered block, the flute a tall narrow bowl
  on a stem, the mug a body with a handle, the coupe a wide shallow bowl on a stem, and in a lab bar
  of more the bulb a sphere with a neck and the cone a deep triangle on a stem.
- **Brews** are the drink's colour and the mark cut out of its glass where the drink sits: a bead
  (fizz, rose), a ring (halo, sky), a band (ribbon, moss), a plus (spark, sand), and in a lab an X
  (ember, lilac) and a triangle (drop, teal). With every piece in one colour, a drink is read by its
  outline and its mark.
- **Ice** is the one square block, a glint cut out of its corner; **a rag** the one ragged cloth with
  its hem cut out.
- **Rings** sit round the square under its drink: the player's one solid amber circle, each rival's
  a dim circle broken into two, three or four arcs, so whose ring it is reads without colour.
- **The board.** Bare ground and one hairline round the bar; a dot on every empty square. The rivals'
  hands sit over the bar, each with its ring, name and points; the player's hand under it, each
  drink's value under it.
- **A turn plays back in order.** The player's drink slides from the hand to its square with a pop;
  the ring appears; a served line shrinks away with its points rising from the square. Then each
  rival's drink slides from its hand the same way, about half a second apart, so every turn can be
  followed. A drink downed shrinks in the hand with its value over it and the rising cue; out cold is
  a dim callout and the thud, and a lost turn a dim "z" over the hand.
- **Callouts**: Served, Served clean, Double, Clean double for the player; a rival's serve is a dim
  callout with the bad cue. Last call ends the round in dim.
- **The beat**, one amber pulse of the whole board, is kept for the double, stronger when clean.

## Engine

`packages/engine/src/pouring/`. Moves: `{ type: "pour", slot, cell }`, `{ type: "drink", slot }`
and `{ type: "end" }`. A move's report is its acts in order: the player's, then every rival's and
every lost turn, until the player is to pour again. Each act names its seat, what it did, the piece
and square, the drink a rag wiped, whether the square was clean, the lines served and the drinks
taken, its points by part, whether it put the pirate out cold, and the seat's hand, the bar and the
rings after it. The board plays the acts back and ends on the engine's bar.

## Tuning notes

Set from bots, not people (ADR 0036). A person's pace is modelled as a turn every 6 seconds, the
rivals' turns played back included; 20 turns take about two minutes.

- **A small bar.** On a 7 by 7 bar with 18 turns each, three pirates served about three lines a
  round between them, and a round was mostly drinks and rings. A 6 by 6 bar and 20 turns each give a
  plain player about one and a half lines, a planning one three to four.
- **No end on a fully rung bar.** The original ends when every square is stained. On 36 squares that
  came after 12 to 16 turns, cutting the round short just as clean squares became scarce; a fixed
  number of turns is easier to read and keeps the last turns, when clean squares are rare, in the
  round.
- **Rings at 20.** At 10 the rollout bot took 70 percent of its points from lines, over the limit
  of rule 14. At 20, rings and drinks together are about a third of a good score.
- **Downing a drink is a pass, and the bait.** Drinking whenever a drink is worth more than the best
  pour's points (the toper) loses to plain careful play: the value is small, and the count costs
  turns.

The bots of this pass, 16 seeds a cell (`pnpm --filter @openseas/bots ladder pouring`):

| Bot | Lines | Clean squares | Full bar |
|---|---|---|---|
| careless | 158 Green | 427 Green | 351 Green |
| one move | 265 Steady | 575 Steady | 608 Steady |
| rollout | 555 Masterful | 1,308 Masterful | 1,188 Masterful |
| any fit | 261 Steady | 410 Green | 421 Green |
| careful | 274 Steady | 725 Steady | 925 Sharp |
| toper | 274 Steady | 725 Steady | 726 Steady |
| *Steady from* | *225* | *450* | *450* |
| *Sharp from* | *375* | *750* | *750* |
| *Masterful from* | *525* | *1,050* | *1,050* |
| *Legendary from* | *713* | *1,425* | *1,425* |

- **careless**: any choice at random, drinks included.
- **one move**: the choice worth most now.
- **rollout**: the eight best choices, each played five turns on, three times, on a fresh random stream.
- **any fit**: pours anything that fits, anywhere, at random; drinks only when nothing fits.
- **careful**: the rivals' own rating every turn: points now, less 60 percent of a line for each gap
  left for the next pirate.
- **toper** (the bait): the careful bot, but downs a drink whenever it is worth more than the best
  pour's points.

Checks: careless lands a tier below one move on every stage; on the whole puzzle the toper loses to
careful by 21.5 percent, and one move (pour for points now, the bait of a greedy player) loses to it
by 34.3 percent. The thresholds sit so that random play is Green, greedy play Steady, a player who
hands nothing over Sharp, and planning play Masterful; Legendary waits for people who build the
cross. On Lines, with no clean squares to save, careful play earns no more than greedy play, and the
stage's thresholds sit at about half the whole puzzle's.

The rivals press as they should: over eight seeds at 70 percent careful turns, the rollout bot
placed first almost every round (a mean place of 1.1 of 3), and the careful bot, which plays exactly
as the rivals do on their careful turns, 2.3.

Open questions for play:

- **The double is rare.** The rollout bot serves one in about one round in ten. Whether people find
  the cross more often, and whether 800 is the right size for it, wants play.
- **Lines are most of a score.** About 60 percent of a planning player's points, near the limit of
  rule 14; they are the puzzle, in three sizes (plain, clean, double).
- **Rival strength.** 70 percent careful turns is a guess at an opponent who is neither a pushover
  nor a wall. The studio's preset of sharp rivals (`rivalSkill` 100) is there to feel the other end.
- **The pace.** Six seconds a turn is a guess, rivals' playback included.
