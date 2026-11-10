# Racks

Status: design brief, not built yet. Prototype (ADR 0036), on the harness at `/racks`. Untimed
moves; a 120 second round.

## The puzzle

Five fuel racks, each a stack that holds up to five cells, and four kinds of cell. A move takes the
top of one rack and puts it on another that has room. Cells of one kind sitting together at the top
move as one, as many as fit. Any cell may sit on any other.

A rack filled to the top with one kind ships out: it scores and comes back empty.

Cells keep arriving. A crate of two or three cells is always waiting, and the rack it will land on
is marked. It lands after every few moves, burying whatever is at the top of that rack. A crate that
does not fit spills: the rack is dumped, for a penalty. The crate can also be called early by
tapping it, which is how a player who is ahead of the work goes faster.

Shipping again within a few moves of the last shipment builds a streak.

## Luck and skill

- **Luck:** what is in the next crate and which rack it is marked for.
- **Skill:** first, sorting. Then, moving groups, and not undoing your own work. Then, reading the
  mark: the rack the crate will hit should be the one you can afford to bury, or the one that wants
  those cells. Then, tempo: two racks one cell from full, shipped on consecutive moves, and the
  crate called the moment there is room.

## Input

- Tap a rack to lift its top group, tap another to set it down; tapping the same rack puts it back.
  Or drag from rack to rack. Tap the crate to call it. Keyboard: 1 to 5 pick and place, C calls.
- The lifted group floats over its rack. Racks that can take it light up. The marked rack shows the
  crate hanging over it and how many moves until it lands.
- A shipment slides the rack's cells out the top with a rising run of notes.

## Engine sketch

Moves `{ type: "move", from, to }`, `{ type: "call" }`, `{ type: "end" }`. The report lists the
cells moved, a shipment, a crate landing (which cells, which rack), a spill, and the next crate and
its mark, for the board to play. The crate's kinds come from a shuffled bag so the kinds stay even;
its rack is drawn from the racks with room for it when there is one.

## To settle by simulation

- Racks, height, kinds, crate size and the moves between crates, so a bot that sorts sensibly stays
  ahead of the crates without ever being idle for long, and a careless one spills.
- Whether any cell may sit on any other (quick, forgiving) or only on its own kind or an empty rack
  (the stricter rule the sorting genre uses). Start with the forgiving rule.
- The streak's window and the spill penalty.
