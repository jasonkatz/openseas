# Racks

Status: built. Prototype (ADR 0036), on the harness at `/racks`. Untimed moves; a 120 second round.

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

About half the crates hold one kind: each cell after the first repeats the one under it half the
time (`crateMixPercent`), and is drawn from a shuffled bag otherwise. The opening is one whole bag,
three cells of each kind, spread over the racks.

## Luck and skill

- **Luck:** what is in the next crate and which rack it is marked for.
- **First skill:** sorting. Like onto like, whole groups, the shorter stack onto the taller.
- **Second skill:** reading the mark. Will the crate fit? If not, there are four moves to make room.
  If it fits, is the rack under it the one that wants those cells, and can it be made so?
- **Third skill:** tempo. A player whose racks are in order calls the crate instead of waiting, and
  gets more cells to ship in the same two minutes. Calling into a crowded row gets a rack smashed.
- **Fourth skill:** the chain. Two racks each one move from full are worth 300 shipped back to back
  and 200 shipped apart, so the order of moves matters, and so does holding a finished rack for one
  more move while the mark and the count allow it.

## Input

- Tap a rack to lift its top group, tap another to set it down; tapping the same rack puts it back.
  Or drag from rack to rack. Tap the crate to call it.
- Keyboard: 1 to 5 lift and set down. Left and right move a cursor, space or enter lifts and sets
  down, escape puts the group back. C calls the crate.
- The lifted group floats over its rack. Racks that can take it light up, and a rack it would
  complete lights gold with what the shipment will score (`racksNextShipment`). Full racks dim.
- The marked rack is outlined, with outlines in its free slots where the crate's cells will sit.
  When the crate has no room its trolley and the rack turn red and throb. When it would complete
  the rack they turn gold.
- A strip over the racks says the same in words: how many moves until the crate lands, that it has
  no room, or that a chain is running and what the next shipment scores.
- Unrated and lab rounds pulse an action worth taking after six seconds idle (`racksHint`): a
  shipment, room under a crate that will not fit, a tidying move, or the call.

## Engine

`packages/engine/src/racks/`. Moves: `{ type: "move", from, to }`, `{ type: "call" }` and
`{ type: "end" }`. A move's report is a list of events in order, for the board to play: `move` (the
cells carried), `ship` (the rack, its place in the chain, its points, whether a crate did it),
`spill` (the cells dumped and the penalty), `land` (the crate's cells, whether it was called) and
`deal` (the next crate and its rack). A move's own shipment comes before the crate lands, so
shipping the marked rack on the last move lets the crate land in an empty rack.

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

- The holding planner beats the plain planner by one percent. Bots hold badly, so this may be the
  bots; if people also find that holding a full rack never pays, the chain wants a third step that
  is worth the wait.
- Chains of three came up about once in three rounds for the best bot. Is that a treat or too rare
  to aim for?
- Is a count of four right for hands, or does the last move before a landing come too fast to read?
- Does a smash want to cost more than cells and 50 points, or less for a new player?
- The hint's rules score 1,380. Should the hint be weaker, so practice does not teach the whole game?
