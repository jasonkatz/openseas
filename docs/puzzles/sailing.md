# Sailing

Status: spec draft. Next puzzle after Bilging (M2). The "Rules to verify" list needs the owner's
sign-off before the engine PR, and the time model needs an ADR (section 8).

## 1. Identity

Steady and rhythmic where Bilging is twitchy. You are on deck working lines: pieces arrive on the
wind and you steer them into place, reading the shape of the board several pieces ahead. The
pleasure is a clean drop that sets off a chain through the board's structure, and watching your
output fill a sail. Motifs: canvas, rope, wind gusts, creaking blocks and tackle. The output meter
is a sail that bellies out as tokens accrue. Sounds are airy: whooshes, rope creaks, a snap of
canvas on a big clear. No water imagery; that belongs to Bilging.

## 2. Faithful core

Falling pieces you steer and rotate into a board. Clears come from forming same-color groups, and
chains run through the board's structure. Performance feeds movement tokens per ship turn.

## 3. Rules to verify

Confidence is ours, before checking the original. The first Bilging build got two of these kinds
of facts wrong, so none of them ship on belief alone.

- [ ] **Piece shape.** Belief: pieces are small multi-block sets (mostly two blocks, sometimes
  three) with blocks of independent colors. Confidence: low.
- [ ] **Clear condition.** Belief: same-color blocks clear as a group once a threshold is met;
  is it lines of 3+, connected groups, or something structural? Confidence: low.
- [ ] **Board structure.** Belief: the board has fixed structure (walls or dividers) that pieces
  settle against and chains run through. What is it, and is it the same every round? Confidence:
  low.
- [ ] **Gravity after a clear.** Do blocks above fall as single blocks, or do pieces stay joined?
  Confidence: low.
- [ ] **Speed.** Does drop speed rise during a round? Is there a soft drop and a hard drop?
  Confidence: medium (there is a fast drop).
- [ ] **Rotation.** Rotation directions, wall kicks, and whether a piece can rotate against
  structure. Confidence: low.
- [ ] **Top-out.** What happens when the board fills: round ends, the board clears with a penalty,
  or the rows compress? Confidence: low.
- [ ] **Specials.** Are there special pieces, and what does each do? Any coined names get original
  ones. Confidence: low.
- [ ] **Output.** What maps puzzle performance to movement tokens: points, clears, chains, or
  something else? Confidence: low.

## 4. Board, pieces and specials

Dimensions and coordinates are fixed once section 3 is verified. Coordinates follow Bilging's
convention: `row` 0 is the bottom, renderers flip. Each block color gets a unique texture and mark
from the same tile system as Bilging, validated unique in content, but with its own palette of
surfaces (canvas weave, rope coil, brass block, tar) so a Sailing board never reads as a Bilging
board. Structure tiles are drawn as part of the board, not as pieces, and are distinguishable from
every piece without color.

## 5. Input

- Touch: drag horizontally to move the piece column by column; tap to rotate; swipe down to drop.
  The column under the finger is the target, not a relative nudge, so a fast drag lands where the
  finger is.
- Mouse: move to aim, click to rotate, right-click or wheel-down to drop.
- Keyboard: left and right move, up rotates, down soft-drops, space hard-drops.
- Ghost piece shows where it will land. Next-piece preview shows the queue (length in content).

## 6. Scoring

To be written as an integer formula after section 3, in the same form as Bilging's: a base for
the group, times groups in a step, times the chain step. If the original's formula is unknown,
we publish ours and record it in `DESIGN.md` section 6.

## 7. Pressure and output

- **Practice page.** The pressure is intrinsic: the board fills if you play badly, and speed rises
  over the round (if verified). No extra meter is invented.
- **Ship (M3).** Output is movement tokens per ship turn. Tokens are computed from what the player
  cleared during that turn, from the move log, never reported by the client.
- **Units and clamps.** Token progress is held in whole units in the state. A token cap per turn
  stops a burst from banking a voyage's worth of movement; progress beyond the cap is wasted, the
  same rule as Bilging's water floor. The cap lives in content.

## 8. Time

Sailing has real-time gravity, which Bilging did not. The engine must stay pure (no timers, no
`Date`), so time enters the move log:

- Every move carries `t`, integer milliseconds since the round started, non-decreasing.
- The engine applies gravity for the elapsed time between moves deterministically, then the move.
  A piece that locks without input is a `lock` move the client logs at its own `t`, so a replay
  needs nothing but the log.
- The server checks `t` against its own clock on receipt: it rejects a `t` in the future beyond a
  tolerance, and a `t` that lags its clock by more than a tolerance, so a client cannot slow time
  down to think. Both tolerances live in content.

Decided by the owner: timestamps on moves, over fixed tick moves or server-driven gravity. It
still gets an ADR ("time in the move log") before the engine PR. Swordfighting will reuse it.

## 9. Client-only timing costs

None planned. Drop speed is a rule and lives in the engine, not the client.

## 10. Moves and reports

Moves: `move {t, col}`, `rotate {t, dir}`, `drop {t}` (hard), `lock {t}` (gravity lock),
`end`. A report carries the piece's landing cells and each chain step with its groups (cells,
block ids, points) and the settled board after the step, exactly like Bilging, so the renderer
replays chains step by step. Block ids are stable within a game and never reused.

## 11. Exploits

- **Infinite lock delay.** Rotating or moving on the floor resets the lock timer. Cap resets per
  piece (content), as modern falling-block games do.
- **Time dilation.** Closed by the server clock checks in section 8.
- **Soft-drop farming.** If soft drop scores, cap it per piece or score none.
- **Banking tokens.** Closed by the per-turn cap.

## 12. Feedback plan

- Every chain step visible: clear, fall, settle, in turn, from the report.
- Callouts for multi-group clears and chain steps, in Sailing's words (to be named; nothing from
  Bilging's set is reused).
- Streak milestones for consecutive clearing pieces.
- Output feedback: the sail fills with each token and snaps taut at the cap; a gust sweeps the
  board on a big chain.
- Danger: the top rows tint and the creak gets louder as the stack nears the top.
- A drop that clears nothing lands with a soft thud; a clearing drop lands with a crack.
- Ambient life: a faint wind ripple across the structure.
- Sounds fire on on-screen events. Reduced motion respected. Hint (best landing for the current
  piece) in unrated practice only.

## 13. Layout

Portrait. Phone: top bar holds back, score with streak chip, time, tokens and mute; the next-piece
queue sits on the board's edge, not in a panel, because it is used every second. Desktop: board
left, HUD, queue and legend in a sidebar.

## 14. Content

`sailing.json`: board size and structure, block colors with textures and marks, piece set and
weights, drop speed curve, lock delay and reset cap, queue length, time tolerances, token formula
and per-turn cap, round seconds, rating thresholds.

## 15. Tests

Determinism with timed logs; board invariants (no floating blocks after settle, no overlap);
report steps end at the final board; gravity applied over a gap equals gravity applied in small
steps (a property test, since `t` granularity must not change the result); lock-reset cap;
server time checks; view-equals-engine smoke check.

## 16. Open questions

- Hard drop: recommended yes on every input method.

Decided:

- Top-out does not end the round. The top rows clear with a score penalty and play continues,
  so a round always runs its full clock and a station never goes dark mid-voyage. If the original
  ended the round, this is a section 6 entry.
