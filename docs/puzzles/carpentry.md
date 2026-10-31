# Carpentry

Status: spec, rules from research plus owner decisions (M2, after Sailing). Items marked
unconfirmed in section 3 are checked in play before the engine PR.

## 1. Identity

Calm and deliberate: the thinking puzzle among the duties. You are in the carpenter's shop
patching holes in the hull with pentomino patches. The pleasure is a hole closed with the fewest
pieces and nothing overlapping. There is no gravity and no hurry within a move; the pressure is
the clock and holes that worsen when ignored. Motifs: wood in several grains, sawdust, nails, a
mallet tap on placement, a plane's shhk when a hole is closed. Callouts are quiet craftsman's
words, not shouts.

## 2. Faithful core

Holes open in a hull. Pentomino pieces are offered and placed to cover them; pieces rotate and
flip. Overlap is allowed but costs score. A hole is rated by how many pieces it took against the
minimum. Neglected holes grow. Output repairs hull damage.

## 3. Rules to verify

From research notes (wiki pages read through search extracts only; see
[`research/original-rules.md`](./research/original-rules.md)). Confidence after research.

- [x] **Board.** Up to four holes active at once, each selected on its own. A size-n hole starts
  with 5n cells. High.
- [x] **Pieces.** Pentominoes. High. Whether the set is the 12 free pentominoes or 13 shapes is
  unconfirmed; recommended the 12.
- [x] **Rotation and flip.** Both allowed. High. Our rotate and flip buttons are faithful.
- [x] **Overlap.** Allowed, over other pieces or sound hull, and lowers the score. High.
- [x] **Neglect.** An empty hole left too long flashes and grows by one cell; in a partly filled
  hole, a piece can shake loose and fly off if left alone. Medium.
- [x] **Rating.** Each hole is rated by pieces used against the minimum n, top tier being exactly
  n pieces with no overlap. High; the formula (top tier worth 2n−4) is medium.
- [ ] **Finishing.** A hole closes when every cell is covered. Inferred.
- [ ] **Offer and discard.** Not found in research; decided by the owner (section 16).

## 4. Board, pieces and specials

Up to four holes, each on its own panel of hull, side by side on phones in a 2 by 2 grid.
Coordinates within a hole: `row` 0 at the bottom, like Bilging. Holes must read against sound
wood without color: a dark recess with a shadowed edge, distinct from any piece fill. Pieces are
all pentominoes, so the cell-count mark from earlier drafts is gone; instead each of the twelve
shapes has its own wood texture and, under the marks setting, a letter-free shape glyph, so a
piece reads by texture alone. Placed pieces keep their texture so a closed hole shows its
patchwork. Overlapping cells are drawn with a visible double thickness.

## 5. Input

- Touch: tap a hole to select it (or it is chosen by dropping on it); drag a piece from the offer
  onto the hole. It snaps to the nearest placement within a radius and lifts above the finger so
  the finger never hides it. Tap the piece in hand to rotate clockwise; two-finger tap rotates
  counter-clockwise; swipe sideways or up/down to flip.
- Mouse: drag and drop; wheel or right-click rotates; `f` flips.
- Keyboard: `1`–`3` pick an offered piece, `q`/`w`/`e`/`r` pick a hole, arrows move, `z`/`x`
  rotate, `f` flips, enter places.
- Placements that overlap show the overlapping cells in red before release, so overlap is always
  a choice.
- Preview: while hovering, the hole's would-be rating shows if this piece is placed.

## 6. Scoring

Per hole, on closing: rated by pieces used against the minimum n. Top tier (n pieces, no
overlap) scores 2n−4 (unconfirmed; our published formula either way), lower tiers less, overlap
cells subtract. Tier names are our own (not the original's labels). The no-fit reroll subtracts a
penalty (section 16). Integers throughout, constants in content.

## 7. Pressure and output

- **Practice page.** New holes open on a move count (not wall time, so it stays a pure function of
  the log); neglected holes grow and partly filled holes can lose a piece, both on move counts.
  The round runs on the clock.
- **Ship (M3).** Output is damage repaired per ship turn. Ship damage arrives as events in the
  move log and opens holes sized to the damage, so a battle's damage is something you see and
  fix.
- **Units and clamps.** Repair is whole points of damage. Repair beyond the ship's current damage
  is wasted, so a crew cannot bank repair before a battle. Same rule as Bilging's floor.

## 8. Time

Turn-based. Growth and loosening are counted in moves, not seconds, so the engine needs no time
model. Clock and move cap in content; the server enforces the deadline. Unconfirmed whether the
original's neglect is timed; if it is, counting moves is a section 6 entry.

## 9. Client-only timing costs

None.

## 10. Moves and reports

Moves: `place {slot, hole, col, row, rotation, flip}`, `reroll`, `end`. A report carries the
placed cells and any overlap, any hole closed (with its rating and points), holes that grew or lost
a piece this move, holes that opened, and the new offer, so the renderer plays place, close, then
new holes and the refilled offer in order.

## 11. Exploits

- **Banking repair:** closed by the cap at current damage.
- **Reroll cycling** for a perfect piece: every reroll costs points.
- **Ignoring a hole** to keep working an easy one: neglected holes grow and get worse to close.
- **Stalling:** the clock runs.

## 12. Feedback plan

- Placement lands with a mallet tap and a small sawdust puff; a placement that keeps the hole on
  track for the top tier gets a brighter tap.
- A closed hole planes smooth with a light sweep, its rating and points rise off it, and the panel
  is fresh hull again.
- Callouts for a top-tier hole, and for closing two holes back to back at top tier.
- Streak milestones for consecutive top-tier holes.
- Pressure feedback: a hole about to grow flashes and creaks; a loose piece shakes before it flies.
- An overlapping placement thunks heavier than a clean one.
- Ambient: dust motes in a shaft of light.
- Sound fires on on-screen events. Reduced motion respected. Hint (a placement that keeps the hole
  at top tier) in unrated practice only.

## 13. Layout

Portrait. Phone: top bar holds back, score, time, repairs and mute; the four holes take the board
area in a 2 by 2 grid; the offer of three sits under them in thumb reach. Desktop: holes left with
the offer beneath, HUD and legend in a sidebar.

## 14. Content

`carpentry.json`: max holes, hole size range and opening rate in moves, growth and loosening
rates in moves, piece set with textures and glyphs, offer size (3), reroll penalty, rating tiers
and constants, overlap penalty, round seconds, max moves, rating thresholds.

## 15. Tests

Determinism; a size-n hole always has 5n cells when it opens and can be closed with exactly n
pieces (the generator only makes such holes); rotation and flip produce exactly the eight
orientations; repair cap model test; report agreement; view-equals-engine smoke check.

## 16. Open questions

None open.

Decided by the owner:

- **Offer.** Three pieces offered; place any one and it is replaced. (The original's offer size is
  unconfirmed; recorded in `DESIGN.md` section 6.)
- **No fit.** When no offered piece can be placed without overlap, the player may reroll the whole
  offer for a score penalty, logged as a move. Since overlap is allowed, a placement always exists;
  the reroll is for when every option is poor.
