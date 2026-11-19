# Racks

Status: built, and deepened in M11 with the manifest and a ladder of four stages (ADR 0066).
Prototype (ADR 0036), in the studio at `/racks`. Untimed moves; a 120 second round.

## The puzzle

Five fuel racks in a row, each a stack that holds five cells, and four kinds of cell. A move lifts
the top of one rack and sets it on another that has room. Cells of one kind sitting together at the
top move as one, as many as fit. Any cell may sit on any other.

A rack filled to the top with one kind ships: it scores 100 (`shipPoints`) and comes back empty.

Cells keep arriving. A crate of two or three cells always hangs over one rack, the marked one, with
a count on its trolley. Every move takes one off the count, and with the move that takes it to zero
the crate lands, on top of whatever is there. The count starts at four (`landEvery`). A new crate is
hung at once, over a rack drawn at random.

Any rack may be marked, a full one too. A crate that finds too little room smashes its rack: every
cell in it is lost, 50 points go with them (`spillPenalty`, never below zero), and the crate sits in
the empty rack. So a mark on a crowded rack is a deadline: clear the rack, or ship it, before the
count runs out.

The crate can be called down at once by tapping it. A call is an action like a move.

A shipment on the action straight after another builds a chain: the second scores 200, the third
300, up to 500 (`chainPercent`, `chainWindow` 1). Any action that ships nothing ends the chain. A
crate that lands to complete its rack ships it, and that counts in the chain like any other
shipment. So a rack one crate short of full, with that crate hanging over it, is a shipment waiting
for a call, and a call can be a link in a chain.

Under the row hangs a **manifest**: two different kinds in an order (`manifestLength`), say a cone
then a tank. A chain that ships a rack of the first and then, on the very next action, a rack of
the second fills it, and it pays 300 on top of the second shipment (`manifestPoints`); a new one is
drawn at once. A shipment of any other kind, or an action that ships nothing, starts it again from
its first kind (a shipment of the first kind counts as its first step). A crate that lands to
complete its rack counts like any other shipment, so a call can be the second step. It is filled
inside one chain, so `chainWindow` decides what "the very next action" means. Off:
`manifestLength: 0`, which draws nothing from the random stream, so a seed deals what it dealt
before there was a manifest.

About half the crates hold one kind: each cell after the first repeats the one under it half the
time (`crateMixPercent`), and is drawn from a shuffled bag otherwise. The opening is one whole bag,
three cells of each kind, spread over the racks.

## Luck and skill

- **Luck:** what is in the next crate, which rack it is marked for, and which kinds the next
  manifest names. The manifest on show is always seen in full; only the one after it is unknown.
- **First skill:** sorting. Like onto like, whole groups, the shorter stack onto the taller.
- **Second skill:** reading the mark. Will the crate fit? If not, there are four moves to make room.
  If it fits, is the rack under it the one that wants those cells, and can it be made so?
- **Third skill:** tempo. A player whose racks are in order calls the crate instead of waiting, and
  gets more cells to ship in the same two minutes. Calling into a crowded row gets a rack smashed.
- **Fourth skill:** the chain. Two racks each one move from full are worth 300 shipped back to back
  and 200 shipped apart, so the order of moves matters, and so does holding a finished rack for one
  more move while the mark and the count allow it.
- **Fifth skill:** the manifest, a chain with a named order. Build a rack of each of its kinds one
  move from full, keep the crate's mark off them, and ship them in its order back to back while
  the count runs. It makes holding pay, which the old open question asked for: the planner that
  plays for it has a chain of three or more in 18 rounds of 32, against 8 for the same planner
  blind to it. Knowing when not to chase it is the same skill: a planner that counts every other
  shipment as nothing ships 9.3 racks a round instead of 12.6, has 0.94 smashed instead of 0.53,
  and scores less. So is calling the moment the crate fits, the eager caller, the puzzle's older
  bait.

The compound move is the manifest's chain: two racks of the named kinds, each one move from full,
shipped in its order on consecutive actions, ideally with a cream trolley as a third link.

## The ladder

A new player climbs four stages (ADR 0066), each passed with one Steady round. Only the whole
puzzle counts. Every stage is the whole puzzle with layers switched off in `stages` in the content
file; the names and one-line cards are `racks.stage.<id>` and `_intro`.

| Stage | Round | What is on | Switched off |
|---|---|---|---|
| Sorting (`sort`) | 60s | Sorting, the crate on a rack with room, the call | The deadline (`markRoom: true`), the chain (`chainPercent: [100]`), the manifest (`manifestLength: 0`) |
| The mark (`mark`) | 90s | The deadline: any rack may be marked, so smashes happen | The chain, the manifest |
| Chains (`chain`) | 120s | The chain, the crate as a link | The manifest |
| Full racks (`full`) | 120s | The manifest | |

The `chain` stage is the puzzle as it was before M11, so it keeps the old thresholds, which were set
on exactly those rules. The other two are those thresholds scaled by what the hint's rules score at
each stage in its time, against what they score on `chain` (sort 48 percent, mark 69), and rounded.
The hint's rules are the yardstick because they play no chain, so a stage without one does not
shrink their score for a reason the player cannot see. They are first guesses from bots and want
setting by hand in the studio.

## Input and feedback

- Tap a rack to lift its top group, tap another to set it down; tapping the same rack puts it back.
  Or drag from rack to rack. Tap the crate to call it.
- Keyboard: 1 to 5 lift and set down. Left and right move a cursor, space or enter lifts and sets
  down, escape puts the group back. C calls the crate.
- Unrated and lab rounds mark an action worth taking after six seconds idle (`racksHint`): a
  shipment, room under a crate that will not fit, a tidying move, or the call. The mark is a cream
  ring round the group to lift and a cream dot where it goes, or a cream ring round the crate. The
  hint is blind to the manifest: it teaches the tidy game, and the manifest is the player's to find
  (its rules fill 0.03 manifests a round).

The board is restyled to the brand book (`docs/BRAND.md`, ADR 0061, ADR 0062): it draws its pieces
in code (`boards/src/racks/pieces.ts`), loads no atlas and has no marks setting.

- **Pieces.** A fuel cell is a vessel with a gauge window cut in it. Each kind is a vessel of its
  own outline, so a kind is told from every other by its silhouette alone; the window is the same
  on all of them. The four in play are a round cell (sand), a square tank (sky), a cone (rose) and
  a pod on its point (moss). A lab's fifth to eighth kinds are a capsule on its side (lilac), a
  cross (teal), a battery (slate) and a pail (cream). No kind is amber, and none is rust, which
  would sit beside the danger of a crate with no room.
- **The board.** Bare ground with one hairline round the strip, the rail and the racks. No frame
  and no grid. A rack is the foot its cells stand on and its number; an empty slot is a small dot.
- **The crate** hangs from a trolley on a rail: two cables and a raised box with its cells in it,
  a little smaller than racked ones, and a chevron under it at the marked rack. The count is a
  number on the trolley. The trolley is dim while the crate fits, and the slots its cells will
  take show each cell's outline in the hairline's colour.
- **No room** is danger: the trolley, the chevron, a ring round the marked rack and the strip.
  A crate that will complete its rack is cream in the same places.
- **A strip** over the rail says the same in words: how many moves until the crate lands, that it
  has no room, that it will ship its rack, or that a chain is running and what the next shipment
  scores (`racksNextShipment`).
- **A lifted group** floats over its rack with an amber ring round it: it is the player's own. A
  cream dot marks the slot it would take on every rack that has room. A rack it would complete is
  ringed in cream with what the shipment will score. The keyboard's rack has an amber ring round
  its number. A rack that refuses the group is ringed in danger for a moment.
- **A move** is the group going straight to its slots in 120ms. A landing crate's cells drop into
  the rack the same way, and the next crate comes down its cables.
- **A shipment** is the rack's cells shrinking to nothing, top first, on a rising run of notes,
  and the points rising in cream. A second shipment in a chain is called out; so is a crate that
  ships its rack.
- **A smash** is the rack's cells shrinking away as the crate lands, the word and the points lost
  in danger, and a danger ring round the rack for a moment.
- **The manifest** is a row under the rack numbers: the word, its kinds as their own pieces a little
  smaller than racked ones, left to right with a dim chevron between them, and what it pays in
  cream mono. The kind it wants next has a cream ring round it; a kind the running chain has
  shipped is drawn in `dim`. Each kind is its own silhouette, so the row reads without colour like
  the racks. While a chain is part way through it, the strip names the kind it wants on this very
  action and what filling it pays (`racksManifestView`). A rack the lifted group would complete,
  where that shipment would fill the manifest, shows both prices, the shipment's and the
  manifest's (`racksManifestAfter`).
- **A filled manifest** is called out ("Manifest filled", in place of the chain's callout), its
  points rise from the row in cream, and it plays the rising cue (`rise`, the one Salvage's order
  plays). The filled row shows whole for a moment, then the new one is posted. When the filling
  shipment is the third of a chain the beat plays instead, and no cue over it.
- **The beat**, one amber pulse of the whole board, is kept for one thing: the third shipment of a
  chain, and each one after it a little stronger. There is no shake, no flash and no glow.

## Engine

`packages/engine/src/racks/`. Moves: `{ type: "move", from, to }`, `{ type: "call" }` and
`{ type: "end" }`. A move's report is a list of events in order, for the board to play: `move` (the
cells carried), `ship` (the rack, its place in the chain, its points, whether a crate did it, and how far through
the manifest the chain is after it), `manifest` (straight after the shipment that filled it: its
kinds, its points and the one drawn in its place), `spill` (the cells dumped and the penalty),
`land` (the crate's cells, whether it was called) and `deal` (the next crate and its rack). A
move's own shipment comes before the crate lands, so shipping the marked rack on the last move lets
the crate land in an empty rack. The manifest is drawn after the opening and the first crate, so
turning it on changes nothing dealt before it; with it off nothing is drawn and the state hashes as
it did before the layer, which a test pins.

## Tuning notes

Set from bots, not people (ADR 0036). All at 70 actions a round unless said, 40 rounds each. The
bots: one that moves at random; a sorter that ignores the crate and calls only when it has nothing
to do; the hint's own rules (a tidy sorter that watches the mark); a planner that looks three
actions ahead, sees the crate, calls when the racks are ready and counts the chain; and the same
planner made to hold a finished rack until a second is ready.

| Bot | Score | Shipped | Smashed | Chain points |
|---|---|---|---|---|
| Random | 19 | 0.9 | 11.0 | 0 |
| Sorter, blind to the crate | 821 | 10.4 | 6.2 | 43 |
| The hint's rules | 1,380 | 12.6 | 0.1 | 118 |
| Planner, never calls early | 1,162 | 8.8 | 0.3 | 285 |
| Planner, blind to the chain | 1,601 | 14.4 | 0.1 | 160 |
| Planner | 1,758 | 14.0 | 0.4 | 375 |
| Planner that holds for a second rack | 1,773 | 12.8 | 0.1 | 500 |

What changed from the brief, and why:

- **Any rack may be marked.** The brief drew the mark from racks with room. With that rule the
  sorter that never looks at the crate scored 1,153 and smashed three racks; a bot that watches the
  crate scored 1,287. The mark hardly mattered. Marking any rack makes it a deadline: the blind
  sorter drops to 821 and six smashed racks, and the bot that watches the crate scores 1,181, nearly
  half as much again. The brief's rule is kept as `markRoom`, a lab preset, to compare.
- **Half the crates are one kind.** With every cell drawn afresh, a crate almost never completed a
  rack (0.2 a round), the call was only a way to get work sooner, and the planner beat the hint's
  rules by a tenth (1,630 to 1,486). With half the crates one kind, a crate ships a rack once or
  twice a round, a call can be a shipment and a link in a chain, and the planner leads by a quarter
  (1,758 to 1,380). With every crate one kind there was nothing left to sort: nearly half of all
  actions were calls (32 of 70).
- **The chain is the very next action, and it doubles.** The brief said "within a few moves". With
  two actions allowed, the sorter that never thinks about chains collected 190 chain points by
  accident, against 43 with one. At steps of a half (100, 150, 200) the chain was a sixth of the
  planner's score and holding a rack for it scored worse than not holding (1,348 to 1,452, measured
  with fully mixed crates). At 100, 200, 300 it is a fifth to a quarter, and the planner that counts
  it leads the one that does not by 157.
- **No rail.** The first build of the engine had the crate ride one rack along with every move, so
  where it landed was a matter of when it was called. It was dropped before the board was built:
  the rack under threat changed with every move, and a move that does nothing became a way to
  steer. The fixed mark asks the same question (prepare this rack, or call now) with one thing to
  read.

What the other numbers showed:

- **A count of four.** At three the hint's rules smashed 0.6 racks a round and the planner had
  less room to call (18 calls against 23). At five a bot that waits for the crate was idle for 13
  actions in 70. Four keeps a tidy sorter clear of smashes with a little time to spare.
- **Four kinds on five racks.** With five kinds there is no spare rack, and a bot that watches the
  crate still smashed 1.2 racks a round (measured with fully mixed crates). Six racks with five
  kinds brought that back to none but makes thin racks on a phone; it is a lab preset.
- **Calling pays, and can be overdone.** The planner that never calls early scores 1,162 against
  1,758. One that calls the moment a crate fits, whatever the racks look like, scores 1,691 and
  smashes 1.4 racks.
- **A smash is never a bargain.** A bot told that a smashed rack costs only the penalty, so that it
  may use the crate to clear a mess, scored 1,755 at a penalty of 50: no gain. With no penalty at
  all it scored 1,273 against 1,667 (measured with fully mixed crates): the lost cells and the
  broken chain are a cost of their own. The 50 is there to be felt, not to balance anything.

### M11: the manifest and the ladder

Set from the bot runner (`packages/bots`, ADR 0067; `pnpm --filter @openseas/bots ladder racks`),
32 seeds a cell (`ladder-0` to `ladder-31`), a person's pace modelled as 70 actions in 120 s. Each
cell is the mean score and the tier it reads as against that stage's thresholds. The bots are the
notes' bots above, rebuilt in the runner, with three more: the planner blind to the manifest (its
points are worth nothing to it), and two baits.

| Bot | Sort (60 s) | Mark (90 s) | Chain (120 s) | Full (120 s) |
|---|---|---|---|---|
| careless | 8 Green | 23 Green | 5 Green | 31 Green |
| one move | 553 Steady | 763 Steady | 1,258 Sharp | 1,373 Sharp |
| rollout | 584 Sharp | 798 Steady | 1,400 Sharp | 1,692 Sharp |
| blind sorter | 552 Steady | 559 Steady | 788 Steady | 748 Steady |
| hint rules | 663 Sharp | 948 Sharp | 1,383 Sharp | 1,377 Sharp |
| planner | 619 Sharp | 861 Sharp | 1,636 Sharp | 2,070 Sharp |
| chain blind planner | 644 Sharp | 883 Sharp | 1,266 Sharp | 1,270 Sharp |
| manifest blind planner | 625 Sharp | 823 Steady | 1,584 Sharp | 1,814 Sharp |
| manifest chaser (the bait) | 364 Steady | 555 Steady | 1,294 Sharp | 1,783 Sharp |
| eager caller (the bait) | 186 Green | 788 Steady | 1,406 Sharp | 1,492 Sharp |
| *Steady from* | *300* | *400* | *600* | *600* |
| *Sharp from* | *575* | *850* | *1,249* | *1,249* |
| *Masterful from* | *1,000* | *1,449* | *2,099* | *2,099* |
| *Legendary from* | *1,525* | *2,124* | *3,149* | *3,149* |

The runner's checks all met: careless play lands a tier below the one-move bot on every stage, and
on the whole puzzle the manifest chaser loses to the planner by 13.9 percent and the eager caller
by 27.9. The chain blind planner counts shipments alone, so it is blind to the manifest too.

- **The layer pays for skill.** On the whole puzzle the planner that plays the manifest scores
  2,070 against 1,814 for the same planner blind to it, 14 percent; at 64 seeds (`ladder-0` to
  `ladder-63`) it is 1,960 against 1,755, 12 percent. It fills 0.94 manifests a round to the blind
  planner's 0.41. The hint's rules, which ignore it, gain nothing (1,383 off, 1,377 on), and fill
  0.03.
- **Rule 14: the manifest is 14 percent of a good score** (the planner's: 282 of 2,070). Rollout,
  which sees it only through play, fills 0.84 and takes 15 percent of its score from it.
- **The baits lose.** The manifest chaser (the planner, counting the manifest three times over and
  every other shipment as nothing) scores 1,783 at 32 seeds, 14 percent under the planner, and
  1,810 at 64, 8 percent under: it fills the most manifests (1.44 a round) but ships 9.3 racks to
  12.6 and has 0.94 smashed to 0.53. The eager caller (calls the moment the crate fits) scores
  1,492, 28 percent under, with 2.8 racks smashed a round. A milder lean toward the manifest than
  the chaser's was about right in the pitch's runs, so the judgement is real.
- **Two kinds in order, not one.** One kind (`manifestLength: 1`, +100) is the contracts trap,
  measured in the pitch: the hint's rules gain 490 points without trying (1,383 to 1,875). Two
  different kinds in order inside one chain is what makes it built rather than found. +300 is the
  pick over +200 (planner 1,948, blind 1,773, a 10 percent gap).
- **Stage thresholds** are first guesses from these bots (see The ladder). Careless play lands a
  tier below the one-move bot on every stage. On `sort` and `mark` the hint's rules beat the
  planner, which plays for a chain those stages do not pay; the eager caller is worst on `sort`
  (186), where `markRoom` means a crate always fits and calling clogs the row.
- **The whole puzzle's thresholds are the owner's and are not moved here.** With the manifest the
  planner rose from 1,636 to 2,070, a hair under Masterful (2,100), where the notes put the
  planner at 90 actions. If they are to keep naming the same play, the top three want raising by
  about a sixth (about 1,750, 2,450 and 3,250); that is for the owner in the studio, with a
  person's rounds.

Thresholds are for a 120 second round. A move is two taps and a call one, so a new player makes
about 45 actions, a steady one 70 and a quick one 90 to 110.

| Rating | Score | From |
|---|---|---|
| 1100 | 300 | the blind sorter's worst tenth at 45 actions |
| 1300 | 600 | the blind sorter at 45 (563) |
| 1500 | 1,000 | the hint's rules at 45 (913), the cautious planner at 70 (1,162) |
| 1700 | 1,500 | between the hint's rules (1,380) and the planner (1,758) at 70 |
| 1900 | 2,100 | the planner at 90 (2,250) |
| 2100 | 2,800 | the planner at 110 (2,776), holding for chains (2,876) |

## Open questions for play

- The holding planner beat the plain planner by one percent, and this list asked whether the chain
  wanted something worth the wait. The manifest is the answer, measured: holding now pays. The planner that plays it chains three or more in 18 rounds of 32 (8 when blind to it)
  and scores 14 percent more. Whether people find the hold, and not only bots, is the new question.
- Can a person read two kinds in order on a phone, under the racks, while also watching the
  trolley? If not, the manifest may want to sit over the rail, beside the strip.
- At under one manifest a round for a good bot, does it feel like a plan or a treat? Three kinds,
  or +400, are cheap to try (`manifestLength`, `manifestPoints` in the studio).
- Should the hint learn the manifest? Today it is blind to it, so practice does not teach it; the
  callout and the strip are its only lessons.
- Are the stage thresholds right for hands? They are scaled from the hint's rules, which sort far
  faster than a new player does.
- Chains of three came up about once in three rounds for the best bot. Is that a treat or too rare
  to aim for?
- Is a count of four right for hands, or does the last move before a landing come too fast to read?
- Does a smash want to cost more than cells and 50 points, or less for a new player?
- The hint's rules score 1,380. Should the hint be weaker, so practice does not teach the whole game?
