# Sailing

Status: spec, rules confirmed by the owner. Next puzzle after Bilging (M2). The time model needs
an ADR before the engine PR (section 8).

## 1. Identity

Steady and rhythmic where Bilging is twitchy. You are on deck rigging sail: pairs arrive on the
wind and you steer them onto spars, reading the board a few pairs ahead. The pleasure is a pair
that completes a spar and sets off a chain as everything above it drops into place, and watching
your output fill a sail. Motifs: canvas, rope, wind gusts, creaking blocks and tackle. The output
meter is a sail that bellies out as tokens accrue. Sounds are airy: whooshes, rope creaks, a snap
of canvas on a big clear. No water imagery; that belongs to Bilging.

## 2. Faithful core

Pairs of colored pieces fall into the board. You steer and rotate them onto **spars**, shelves
whose slots each want a particular color. Fill every slot on a spar and the spar clears; four of a
color in a straight line also clear. Pieces left hanging fall, and every further clear is a chain
step. Clear every spar and a fresh board arrives. Performance feeds movement tokens per ship turn.

## 3. Rules verified

Confirmed by the owner against the original, from research notes (the wiki pages were summarized
through search extracts, not read in full; see `pp-rules-research` in the PR).

- [x] 8 wide by 16 tall. Pairs enter from the two center columns.
- [x] Pieces are joined pairs, three colors.
- [x] Four or more of a color in a straight row or column clear. Straight lines only, not
  connected groups, and no diagonals.
- [x] Spars are solid shelves carrying colored slots. Filling every slot of a spar with the
  matching color clears those pieces and the spar. All completed spars clear together.
- [x] A landed pair stays joined until one half clears; then the other half falls. This is how
  chains are built.
- [x] Fixed pre-placed squares ("snags") sit on the board and get in the way.
- [x] No special pieces.
- [x] Clearing every spar on screen brings a fresh board, with no extra bonus.
- [x] Top-out: if either spawn cell is still occupied once the board settles, the player loses a
  flat penalty (20) and gets a fresh board.
- [x] Boards get harder the longer a player goes without topping out.

Still to pin before the engine PR, with our recommendation:

- How snags clear. Recommended: only as part of a four-in-a-line, and they score the most of any
  piece.
- Whether the fast-drop key is a hard drop. Recommended: fast soft drop that still allows moves
  and rotation, as the research suggests; plus a separate hard drop on touch (swipe down).
- Exact scoring weights (section 6).

## 4. Board, pieces and specials

8 wide by 16 tall. `col` 0..7 left to right, `row` 0..15 bottom to top, the same convention as
Bilging; pieces fall toward row 0 here. Spawn cells are the two center columns of the top row.

- **Pieces.** Three colors, each a tile with its own texture and mark from the shared tile system,
  in a Sailing palette: canvas (cream weave), hemp (tan rope twist), pennant (red with a stripe).
  The original's water, rope and wind theming is not reused.
- **Pair link.** A joined pair is drawn with a lashing across the shared edge, so it reads which
  pieces will fall together.
- **Spars.** Drawn as part of the board, as timber shelves. Each slot shows a hollow outline of its
  color's texture and mark, so a slot's color reads without color.
- **Snags.** Dark tiles with an icon and a label, like Bilging's specials.
- **Board generation.** Spars and snags are generated from the seed with difficulty rising per
  board since the last top-out; generator parameters live in content.

## 5. Input

- Touch: drag horizontally to move the pair to the column under the finger (absolute, not a
  relative nudge); tap to rotate; hold to fast-drop; swipe down to hard-drop.
- Mouse: move to aim, click to rotate, wheel-down to fast-drop.
- Keyboard: left and right move, up and down rotate, space fast-drops, shift hard-drops.
- Ghost pair shows where it will land. Next-pair preview (length in content).

## 6. Scoring

Scored per pair dropped, not per second, as in the original. Integer formula, constants in
content: points for each piece cleared by a spar (more than a line clear), snags worth the most,
each chain step multiplying the step's points by its step number, the same chain rule as Bilging.
The original's exact weights are not known; ours are published and recorded in `DESIGN.md`
section 6.

## 7. Pressure and output

- **Practice page.** The pressure is intrinsic: the board fills if you play badly, a top-out costs
  20 and the board, and difficulty rises board by board.
- **Ship (M3).** Output is movement tokens per ship turn, computed from the move log (points per
  pair over the turn), never reported by the client. Bilging water slows token generation through
  the ship model, as in the original.
- **Units and clamps.** Token progress is whole units in the state. Tokens unused for five ship
  turns expire (the original's rule, `sea-battle.md`), which is what stops a crew banking a
  voyage's movement. Progress per turn is capped in content; beyond it is wasted.

## 8. Time

Sailing has real-time gravity, which Bilging did not. Decided by the owner: **timestamps on
moves.**

- Every move carries `t`, integer milliseconds since the round started, non-decreasing.
- The engine applies gravity for the elapsed time between moves deterministically, then the move.
  A pair that locks without input is a `lock` move the client logs at its own `t`, so a replay
  needs nothing but the log.
- The server checks `t` against its own clock on receipt: it rejects a `t` in the future beyond a
  tolerance, and a `t` that lags its clock by more than a tolerance, so a client cannot slow time
  down to think. Both tolerances live in content.

This gets an ADR ("time in the move log") before the engine PR. Swordfighting and Gunnery reuse
it.

## 9. Client-only timing costs

None. Drop speed is a rule and lives in the engine.

## 10. Moves and reports

Moves: `move {t, col}`, `rotate {t, dir}`, `drop {t}` (hard), `lock {t}`, `end`. A report carries
the pair's landing cells, then each chain step: spars and lines cleared (cells, piece ids, points),
links broken, and the settled board after the step, exactly like Bilging, so the renderer replays
chains step by step. A fresh board after a full clear or a top-out is its own step. Piece ids are
stable within a game and never reused.

## 11. Exploits

- **Infinite lock delay.** Moving or rotating on a surface resets the lock timer; resets per pair
  are capped (content).
- **Time dilation.** Closed by the server clock checks in section 8.
- **Fast-drop farming.** Fast drop scores nothing.
- **Deliberate top-out** to reroll a bad board: costs 20 and resets difficulty, which lowers later
  scoring, so it does not pay.
- **Banking tokens.** Closed by expiry and the per-turn cap.

## 12. Feedback plan

- Every chain step visible: clear, links break, fall, settle, in turn, from the report.
- A completed spar lifts away like a yard being hauled up; a line clear snaps like a rope parting.
- Callouts for clearing two or more spars at once and for chain steps, in Sailing's own words
  (nothing from Bilging's set is reused).
- Streak milestones for consecutive pairs that clear something.
- Output: the sail fills with each token and snaps taut at the cap; a gust sweeps the board on a
  big chain.
- Danger: the spawn cells tint and the creak gets louder as the stack nears them. A top-out tangles
  and drops the board, then the new board unfurls.
- A pair that clears nothing lands with a soft thud.
- Ambient: a faint wind ripple across the spars.
- Sound fires on on-screen events. Reduced motion respected. Hint (the best landing for the current
  pair) in unrated practice only.

## 13. Layout

Portrait. Phone: top bar holds back, score with streak chip, time, tokens and mute; the next-pair
preview sits on the board's edge, not in a panel, because it is read every second. Desktop: board
left, HUD, preview and legend in a sidebar.

## 14. Content

`sailing.json`: board size, piece colors with textures and marks, board generator parameters by
difficulty, drop speed by difficulty, fast-drop speed, lock delay and reset cap, preview length,
time tolerances, scoring constants, top-out penalty (20), token formula and per-turn cap, round
seconds, rating thresholds.

## 15. Tests

Determinism with timed logs; no floating pieces after settle (a piece rests on the floor, a spar,
another piece, or its linked half); spars clear only when every slot matches; report steps end at
the final board; gravity over one long gap equals gravity over many short gaps; lock-reset cap;
top-out detection; server time checks; view-equals-engine smoke check.

## 16. Open questions

- How snags clear (recommended in section 3).
- Hard drop: recommended a separate hard drop on every input method.
