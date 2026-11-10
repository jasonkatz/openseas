# Cutting

Status: design brief, not built yet. Prototype (ADR 0036), on the harness at `/cutting`. Untimed
moves; a 120 second round.

## The puzzle

A slab of salvage, six by six, made of blocks of three or four ores, with a few flaws: single cells
of the wrong ore sitting in a block. The cutting torch makes straight cuts along the grid. A cut
runs the whole way across the piece it is made in and splits that piece in two, so every piece is
always a rectangle.

A piece that holds one ore only is pure: it banks at once for its area squared. One pure piece of
twelve cells is worth four times two pieces of six, so the art is freeing the big blocks whole.

Cuts are limited: each slab comes with a number of them. When the cuts are spent, or nothing more
can be banked, the slab is done, what is left unbanked is scrap, and the next slab is dealt.

The engine knows the best a slab can give for its cuts (a small exact search over rectangles), so a
finished slab is graded against it: flawless at the best, clean within a fifth of it, rough below.
Clean and flawless slabs build a streak that multiplies the slab's bonus.

## Luck and skill

- **Luck:** the slab.
- **Skill:** first, seeing a pure rectangle and cutting it free. Then, order: a cut runs across the
  whole piece, so an early cut made carelessly goes straight through a block you wanted whole.
  Then, the budget: with one cut too few for everything, which block to give up, and whether to cut
  a flaw out of a big block or bank the smaller pure piece beside it.

## Input

- Drag across a piece along a grid line: the cut snaps to the nearest line, shows where it will run,
  and is made on release. Or tap near a line to preview it and tap again to cut. Keyboard: arrows
  move the cut line, tab switches between across and down and between pieces, space or enter cuts,
  D ends the slab early.
- The cut flashes, the two pieces ease apart, and a pure piece glows, pops its points and flies off.
  The strip shows the cuts left and what has been banked against the best.
- Unrated and lab rounds may pulse a cut from a best plan after a pause.

## Engine sketch

Moves `{ type: "cut", piece, vertical, at }`, `{ type: "done" }`, `{ type: "end" }`. A piece is a
rectangle with an id. A slab is dealt by splitting the rectangle at random a few times, giving each
part an ore, then scattering flaws; the cuts allowed are the parts less one. The best value is a
table over rectangles and cuts left: a pure rectangle is worth its area squared, and otherwise the
best split over every cut line and every share of the remaining cuts. The same table ends a slab
when nothing more can be banked, and gives the hint.

## To settle by simulation

- Parts, flaws and cuts, so the best plan is not obvious and a greedy cutter (free the biggest pure
  rectangle now) lands at 70 to 85 percent of it.
- Whether scrap should pay a little, so a player is not punished to zero for a near miss.
- The bonus for clean and flawless slabs against the points banked along the way.
