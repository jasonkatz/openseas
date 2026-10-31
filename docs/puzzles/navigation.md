# Navigation

Status: spec draft (M2, the last duty puzzle). The "Rules to verify" list needs the owner's
sign-off before the engine PR.

## 1. Identity

Contemplative pattern-matching. You are at the chart table at night, shifting a field of pieces
until it matches a target constellation. The pleasure is spotting the move sequence that snaps a
pattern into place, and the quiet moment when it does. Motifs: night sky, brass instruments,
chart paper, ink lines joining stars. Sounds are soft and tonal: a glassy chime per star aligned,
a sustained chord when a pattern completes. The slowest-paced duty; nothing shakes.

## 2. Faithful core

Arrange and shift pieces to reproduce a target constellation. Completed patterns grant token
bonuses and sea battle advantages. QoL: a target overlay toggle and a progress meter.

## 3. Rules to verify

- [ ] **Board.** Size and shape of the field, and of a target pattern. Confidence: low.
- [ ] **Moves.** Do you shift whole rows and columns, swap pieces, or rotate regions? Do shifts
  wrap around? Confidence: low.
- [ ] **Matching.** Must the pattern appear at a fixed place or anywhere? In any rotation?
  Confidence: low.
- [ ] **Completion.** When a pattern completes, does the board clear, refill or shift? Does the
  next target arrive immediately? Confidence: low.
- [ ] **Pieces.** How many kinds, and do some kinds act as wildcards or blockers? Confidence: low.
- [ ] **Scoring.** Per pattern, scaled by moves taken or by pattern difficulty? Confidence: low.
- [ ] **Output.** What a completed pattern grants the ship, and whether it differs by pattern.
  Confidence: low.

## 4. Board, pieces and specials

Fixed once section 3 is verified. Coordinates as in Bilging (`row` 0 at the bottom). Pieces are
stars and must read without color: each kind has a distinct star shape and glow texture, plus a
mark. The target pattern shows in a small chart beside the board and, with the overlay toggle, as
faint outlines on the board itself. Pieces already in their target place get a steady glow, so
progress is visible without the meter.

## 5. Input

To be fixed with section 3. If moves are row and column shifts: drag a row or column and it
follows the finger in whole cells, previewing the result before release. Keyboard: arrows choose a
line, shift-plus-arrow moves it. A move that would complete the pattern is highlighted on hover or
hold.

## 6. Scoring

Integer formula after section 3. Recorded in `DESIGN.md` section 6 if it differs from the
original's.

## 7. Pressure and output

- **Practice page.** The pressure is the clock and, if verified, a move budget per pattern.
- **Ship (M3).** Output is token bonuses and sea battle advantages per completed pattern, applied
  at the ship turn they complete in.
- **Units and clamps.** Advantages do not stack beyond a cap per sea battle turn (content), so a
  navigator cannot bank a battle's worth of advantages during a quiet leg. Unused bonuses expire
  at the end of the ship turn, the same principle as Bilging's floor.

## 8. Time

Turn-based. Clock and move cap in content; the server enforces the deadline.

## 9. Client-only timing costs

None.

## 10. Moves and reports

Moves fixed with section 3, plus `end`. A report carries each piece's path for the move (shifts
can move many pieces at once), the cells now matching the target, and any completion with the next
target, so the renderer can slide everything together and then celebrate.

## 11. Exploits

- **Banking advantages:** closed by the per-turn cap and expiry.
- **Undo by reverse shift:** allowed (it costs a move), so a move budget, if any, is the limiter.
- **Stalling:** the clock runs.

## 12. Feedback plan

- Shifts glide with a soft ease; each piece that lands in its target place chimes, pitched up the
  scale as more align.
- A completed pattern draws ink lines between its stars, holds a beat, then the new target fades
  in.
- Callouts for completing a pattern in very few moves and for completing two in a row quickly.
- Streak milestones for consecutive patterns under par.
- A move that aligns nothing makes a muted tick.
- Pressure feedback: the sky slowly lightens toward dawn as the clock runs down.
- Ambient: slow twinkle, an occasional shooting star (decorative, never on the board).
- Sounds fire on on-screen events. Reduced motion respected. Hint in unrated practice only.

## 13. Layout

Portrait. Phone: top bar holds back, score, time, patterns and mute; the target chart sits above
the board on the board's own surface, since it is read every move. Desktop: board left, target and
HUD in a sidebar.

## 14. Content

`navigation.json`: board size, piece kinds with textures and marks, pattern library or generator
parameters, move budget, scoring constants, advantage table and caps, round seconds, rating
thresholds.

## 15. Tests

Determinism; shifts are permutations (piece counts never change); every generated target is
reachable from the current board; report agreement; view-equals-engine smoke check.

## 16. Open questions

None open.

Decided:

- Target patterns come from a hand-made library in content, not a generator, so difficulty is
  tunable and every pattern is known to be reachable. A content test checks reachability.
