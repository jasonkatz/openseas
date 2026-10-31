# Navigation

Status: spec, rules from research plus owner decisions (M2, the last duty puzzle).

## 1. Identity

Contemplative and circular. You are at the chart table at night: stars drift inward toward the
center of a round chart, and you turn its rings to catch each one in the outline of a
constellation. The pleasure is turning a ring once and watching three stars settle into a shape
that completes. Motifs: night sky, brass instrument rings, chart paper, ink lines joining stars.
Sounds are soft and tonal: a ring's ratchet click, a glassy chime per star placed, a sustained
chord when a constellation completes. The slowest-paced duty; nothing shakes.

## 2. Faithful core

A round board of three concentric rings, eight positions each. Stars with a color and a shape
fall inward from the rim. You rotate one ring at a time to line stars up with constellation
outlines drawn on the rings. Filling an outline completes the constellation. Bigger constellations
are worth much more. A star that comes to rest on the outermost ring with nowhere to go is a
failure.

## 3. Rules to verify

From research notes ([`research/original-rules.md`](./research/original-rules.md)). Confidence
after research.

- [x] **Board.** Three rings of eight positions. High.
- [x] **Stars.** Each has a color and a shape and falls inward from one of eight rim points; a
  star keeps sinking while the cell inward of it is empty. High.
- [x] **Action.** Rotate one ring at a time, clockwise or counter-clockwise; fast-drop the falling
  star. High.
- [x] **Targets.** Constellations are outlines on ring regions, each marker wanting a star of a
  given color and shape. High.
- [x] **Scoring.** Weighted heavily toward constellation size, with efficiency counting. High on
  the shape, formula unknown.
- [x] **Failure.** A star landing on another in the outermost ring fails (on the ship, the ship
  loses course). Medium.
- [ ] **Completion.** Not found; decided by the owner (section 16).

## 4. Board, pieces and specials

Polar coordinates: `ring` 0 is the innermost, 2 the outermost; `slot` 0..7 clockwise from the
top. Stars must read without color: each kind has a distinct star shape and glow texture plus a
mark, and an outline marker shows the hollow shape of the star it wants. Stars already sitting in
a matching marker get a steady glow, so progress shows without a meter. The falling star's rim
point is lit before it enters.

## 5. Input

- Touch: drag around a ring to turn it, snapping to slots; tap a ring to select it, then tap the
  left or right half of the board to turn it a step. Swipe inward to fast-drop.
- Mouse: drag a ring, or select with a click and turn with the wheel.
- Keyboard: `1`–`3` select a ring, left and right turn it, down fast-drops.
- Preview: while dragging, the falling star's landing cell is marked, and markers it would fill
  glow.

## 6. Scoring

Per completed constellation: a base that grows faster than linearly with its size, reduced by the
ring turns spent since the last completion. Integers, constants in content. The original's formula
is not known, so ours is published and recorded in `DESIGN.md` section 6.

## 7. Pressure and output

- **Practice page.** Stars keep coming; the outer ring fills if you fall behind, and an outer-ring
  failure costs a penalty and clears the board. The clock runs.
- **Ship (M3).** Output is course keeping, with token bonuses and sea battle advantages per
  completed constellation, applied at the ship turn they complete in. An outer-ring failure costs
  the ship course, as in the original.
- **Units and clamps.** Advantages do not stack beyond a cap per sea battle turn (content), and
  unused bonuses expire at the end of the ship turn, so a navigator cannot bank a battle's worth
  of advantages during a quiet leg.

## 8. Time

Real time: stars fall on their own. Uses the Sailing time model (timestamps on moves) and its
ADR.

## 9. Client-only timing costs

None.

## 10. Moves and reports

Moves: `turn {t, ring, dir}`, `drop {t}`, `lock {t}`, `end`. A report carries every star's path
for the elapsed time (inward falls, ring turns carrying stars), markers filled, constellations
completed with their stars cleared, the new outline that replaces each, and any failure, so the
renderer can turn, settle, then celebrate in order.

## 11. Exploits

- **Banking advantages:** closed by the per-turn cap and expiry.
- **Spinning rings for free:** turns reduce the next completion's score.
- **Time dilation:** closed by the server clock checks.

## 12. Feedback plan

- Rings turn with a ratchet click per slot; a star that lands in a matching marker chimes, pitched
  up the scale as the constellation nears complete.
- A completed constellation draws ink lines between its stars, holds a beat, the stars fade out
  and the new outline inks in.
- Callouts for large constellations and for two completions in quick succession.
- Streak milestones for consecutive constellations under the par of turns.
- Pressure: the outer ring's free slots glow amber as they run out; a failure smears the chart.
- A turn that places nothing makes a muted tick.
- Ambient: slow twinkle, an occasional shooting star outside the board.
- Sound fires on on-screen events. Reduced motion respected. Hint in unrated practice only.

## 13. Layout

Portrait. Phone: top bar holds back, score, time, constellations and mute; the round chart takes
the board area, centered. Desktop: chart left, HUD and legend in a sidebar.

## 14. Content

`navigation.json`: star kinds with textures and marks, constellation library (hand-made outlines
with sizes), fall speed curve, spawn weights, scoring constants, failure penalty, advantage table
and caps, time tolerances, round seconds, rating thresholds.

## 15. Tests

Determinism with timed logs; stars never overlap and always rest on the center or another star;
every library constellation fits the rings; ring turns are rotations (star count never changes);
report agreement; view-equals-engine smoke check.

## 16. Open questions

None open.

Decided by the owner:

- **Completion.** A completed constellation's stars clear off the rings and a new outline arrives,
  so the board keeps breathing. (The original's behavior is unconfirmed; recorded in `DESIGN.md`
  section 6.)
- **Patterns.** Constellation outlines come from a hand-made library in content, not a generator.
