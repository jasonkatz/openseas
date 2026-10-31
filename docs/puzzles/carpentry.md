# Carpentry

Status: spec draft (M2, after Sailing). The "Rules to verify" list needs the owner's sign-off
before the engine PR.

## 1. Identity

Calm and deliberate: the thinking puzzle among the duties. You are in the carpenter's shop
patching the hull; holes in the planking appear and you choose which offered piece fills which
gap. The pleasure is a snug fit and a plank finished clean with nothing wasted. There is no
gravity and no hurry within a move; the pressure is the clock and the damage queue. Motifs: wood
in several grains, sawdust, nails, a mallet tap on placement, a plane's shhk when a plank is
finished. Callouts are quiet craftsman's words, not shouts.

## 2. Faithful core

Polyomino pieces are offered from a queue and placed to fill holes in planking. Tighter fills with
fewer gaps score higher and feed repair output.

## 3. Rules to verify

- [ ] **Board.** Belief: several planks side by side, each with a pattern of holes, and a plank is
  replaced when finished. How many planks, how big, and do holes come pre-made or arrive over
  time? Confidence: low.
- [ ] **Pieces.** Belief: polyominoes up to five cells. Which set, and is it weighted?
  Confidence: medium.
- [ ] **Offer.** Belief: a small number of pieces offered at once and a placed one is replaced.
  How many are offered? Can you discard? Confidence: low.
- [ ] **Rotation.** Can the original's pieces be rotated or flipped? This decides whether our
  rotate button (a QoL item in `DESIGN.md` 3.3) is a QoL item or a rules change. If the original
  forbids rotation, adding it lowers the skill ceiling and needs a section 6 entry or removal.
  Confidence: low.
- [ ] **Placement.** Must a piece cover only holes, or may it overlap sound wood? Can a piece
  bridge two planks? Confidence: low.
- [ ] **Finishing.** When is a plank finished: all holes filled, or a threshold? Is a partly
  filled plank scored or lost when replaced? Confidence: low.
- [ ] **Scoring.** How fit quality is scored: per plank, per piece, by leftover holes?
  Confidence: low.

## 4. Board, pieces and specials

Fixed once section 3 is verified. Coordinates: `row` 0 at the bottom, like Bilging. Holes are the
board's "pieces" here: they must read against sound wood without color (a dark recess with a
shadowed edge, distinct from any piece fill). Offered pieces each get a wood texture by size class
(pale pine, oak, tarred), with a mark showing the cell count under the marks setting, so a piece's
size reads without counting. Placed pieces keep their texture so a finished plank shows its
patchwork.

## 5. Input

- Touch: drag a piece from the offer onto the board. It snaps to the nearest valid placement
  within a radius, and lifts above the finger so the finger never hides it. A rotate button sits
  beside the offer (if section 3 allows rotation); two-finger twist also rotates.
- Mouse: drag and drop; right-click or wheel rotates.
- Keyboard: number keys pick an offered piece, arrows move it, `r` rotates, enter places.
- Valid placements highlight while dragging; an invalid spot shows the piece red and does not
  place.
- Preview: while hovering a valid spot, the cells that would finish a plank glow.

## 6. Scoring

Integer formula after section 3. Candidate shape, if the original's is unknown: points per plank
finished, scaled up for finishing it with fewer pieces, with no points for a plank replaced
unfinished. Recorded in `DESIGN.md` section 6 if it differs.

## 7. Pressure and output

- **Practice page.** New holes keep arriving on a move count (not wall time, so it stays a pure
  function of the log), and a plank left too long degrades into a bigger hole. The round runs on
  the clock.
- **Ship (M3).** Output is damage repaired per ship turn. Ship damage arrives as events in the
  move log and becomes holes on the board, so a battle's damage is something you see and fix.
- **Units and clamps.** Repair is whole points of damage. Repair beyond the ship's current damage
  is wasted, so a crew cannot bank repair before a battle. Same rule as Bilging's floor.

## 8. Time

Turn-based: the engine advances only on placements and discards. Clock and move cap in content;
the server enforces the deadline.

## 9. Client-only timing costs

None.

## 10. Moves and reports

Moves: `place {slot, col, row, rotation}`, `discard {slot}` (if allowed), `end`. A report carries
the placed cells, any planks finished (with their cells and points), the planks that replace
them, and the new offer, so the renderer can play place, finish, then the new plank sliding in.

## 11. Exploits

- **Banking repair:** closed by the cap at current damage.
- **Discard cycling** for a perfect piece: if discards exist, each costs a move or a point.
- **Stalling:** the clock runs.

## 12. Feedback plan

- Placement lands with a mallet tap and a small sawdust puff; a snug fit (no hole cells left
  adjacent) gets a brighter tap.
- A finished plank planes smooth with a light sweep along it, the points rise off it, and the new
  plank slides in.
- Callouts for finishing two planks with one piece, and for a plank finished with its minimum
  number of pieces.
- Streak milestones for consecutive pieces that finish or advance a plank.
- Pressure feedback: a plank about to degrade creaks and darkens at the edges.
- An invalid drop slides back to the offer with a dull knock.
- Ambient: dust motes in a shaft of light.
- Sounds fire on on-screen events. Reduced motion respected. Hint (a valid, good placement) in
  unrated practice only.

## 13. Layout

Portrait. Phone: top bar holds back, score, time, repairs and mute; the offer sits under the board
in thumb reach, and the board takes the rest. Desktop: board left with the offer beneath, HUD and
legend in a sidebar.

## 14. Content

`carpentry.json`: plank count and size, hole generation, piece set and weights, offer size, rotation
allowed, discard cost, degrade timing in moves, scoring constants, round seconds, max moves, piece
textures and marks, rating thresholds.

## 15. Tests

Determinism; placements never overlap sound wood or other pieces (unless section 3 says
otherwise); offers always contain at least one legal placement, or the round's rule for "no legal
move" is applied; the repair cap model test; report agreement; view-equals-engine smoke check.

## 16. Open questions

- What happens when no offered piece fits? Recommended: a free discard of the whole offer, logged
  as a move.
