# Plating

Status: in the game. Built in M2. On the harness at `/plating`.

## The puzzle

Polyomino pieces offered from a queue, placed to seal breaches in the hull plating. Tighter
fills with fewer gaps score higher and feed repair output. QoL: drag-and-drop with snap and a
rotate button, valid-placement highlight, swap between offered pieces.

## Role

A duty station: the patch bay. Its output repairs the ship's hull each turn (DESIGN.md 3.4), as a percent of `parScore`, capped by `outputCapPercent`. The cap is high so a whole seal reaches the ship in the turn it lands (ADR 0030).

## Luck and skill

- **Luck:** the shape of each breach, and the three plates in the tray.
- **First skill:** sealing each breach with as few plates as it takes.
- **Second skill:** taking the brushing bonus on every seal, and knowing how many plates a breach allows before its rating drops.
- **Third skill:** sealing flawlessly on purpose, and finding a home for the plates that fit nothing.
- **Fourth skill:** putting flawless seals back to back for the streak, before an idle breach widens.

## Rules and scoring

A 9 wide by 12 tall stretch of hull with up to three breaches open at once. A breach is
dealt as one to three pentominoes laid edge to edge, so its area is a multiple of five and a
perfect fill exists; breaches never touch. Three plates wait in a tray, each one of the twelve
pentominoes with a metal (tin, copper, steel or brass; cosmetic) and a brushing that turns with it. A plate goes down anywhere
it covers at least one open cell; it works the breach it covers most of, and cells it lays over hull
or over another plate are waste. Parts that hang off the board, or lie over a second breach or over
plated hull, are not laid at all and are waste too, so any breach can be worked from any plate. When every cell of a breach is covered it is sealed, its plates come off and a new breach
is dealt elsewhere. The seal is rated by extra plates beyond the minimum (area over five):
none is flawless (which also demands no waste), one solid work, two it'll hold, three
duct tape, four or more chewing gum and hope. Points are area times `basePerCell` times the
rating's multiplier, plus a quarter more when every plate's brushing runs across, times the
flawless streak's multiplier: `streakPercent` gives ×1 for the first flawless seal in a row, then
×1.25, ×1.5, ×1.75, and ×2 from the fifth on; a lesser seal resets it. Per plate the rating
already slopes steeply (on a ten-cell breach a flawless seal is 60 a plate, one that will hold 15), so the
streak is a bonus on top, never the whole round. A breach left alone while
`growAfterMoves` plates go elsewhere widens by one cell, and a widened breach can no longer be
flawless. The round ends on the clock; `maxMoves` only bounds the log.

## Input and feedback

A round starts with no plate in
hand; the player picks one from the tray. Control is built around the
plate's centre: it sits under the pointer (lifted above a finger), and a spot that will not take it
snaps to a neighbouring one that will, so dropping near a breach is enough. A mouse carries the plate
by hovering and welds it with a click; right-click or the scroll wheel turns it. Touch drags the plate
and sets it down by letting go over the hull, where an icon toolbar follows it (turn either way,
flip, and a welder to weld it down; the ghost visibly turns over on a flip, so a symmetric plate that lands
looking the same still answers the press);
letting go or dragging off the hull sends it back to its slot, and a tap on bare hull brings it
there. Turning pivots about the
centre so the ghost stays put. The keyboard picks a slot, moves, turns either way, flips, and jumps
through the placements with the least waste. Plates drop in and knock; a sealed breach's plates lift
away; new breaches crack open through the plating; a breach two idle plates from widening pulses amber,
then red. Numbers live in `content/data/puzzles/plating.json`.

## Engine

`packages/engine/src/plating/`. Its header comment in `types.ts` states the rules; numbers are in
`packages/content/data/puzzles/plating.json`.

## Tuning notes

What was changed from the original and why is in `DESIGN.md` section 6, in the rows that begin
"Plating". New tuning is recorded here: what was tried, what the bots or testers scored, what was kept.

## Open questions for play

- None recorded yet. The tester sessions (DESIGN.md 5.2) are still to run.
