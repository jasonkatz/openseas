# Gunnery

Status: spec, rules from research (M2, after Carpentry). `DESIGN.md` 3.2 flags Gunnery as the
likeliest puzzle to need a redesign; whether it does is the owner's call after playing it with
testers. This spec is the faithful version.

## 1. Identity

Traffic control under fire. You are on the gun deck as powder, wads, shot and water buckets roll
out of a barrel and across the deck on their own. You lay down a few arrows to steer each one into
the right gun at the right moment. The pleasure is a gun ramming home its last piece while two
others are mid-load. Motifs: black iron, rope, smoke, sparks, the clank and roll of shot on
planks. The guns sit at the board's edges and are part of the HUD. Sound is percussive: rolling
rumbles, clanks off obstacles, a deep thump when a gun is ready.

## 2. Faithful core

A barrel releases pieces that roll across the deck in real time. You place direction arrows to
steer them into four cannons. Each cannon loads powder, then wad, then ball. A wrong piece fouls
it, and a water bucket flushes it. Scored on speed, then on how few arrows you used.

## 3. Rules to verify

From research notes ([`research/original-rules.md`](./research/original-rules.md)). Confidence
after research.

- [x] **Board.** Four cannons, a central barrel that releases pieces, side hatches to dump
  unwanted pieces. High. Exact board size: unconfirmed.
- [x] **Items.** Powder, wad, ball, water bucket. No other pieces or hazards. High.
- [x] **Order.** Powder, wad, ball. A loaded cannon becomes one gun for the ship. High.
- [x] **Wrong piece.** Fouls the cannon until a bucket flushes it; a bucket also clears a cannon
  after it fires. A bucket only needs to be the last piece in before loading starts. High.
- [x] **Movement.** Real time. Pieces roll straight; at an obstacle a piece turns right if it can,
  else left, else reverses; two pieces that collide both reverse. High.
- [x] **Arrows.** At most three on the board; a fourth removes the oldest. A piece crossing an
  arrow takes its direction. High.
- [x] **Speed.** Piece speed is set from the player's standing and builds during a session.
  Medium.
- [x] **Scoring.** Speed first (time on board per gun loaded), then fewest arrows. High on the
  order, medium on the formula.
- [x] **Barrel order.** Unconfirmed in the original; decided by the owner: a seeded bag weighted
  toward what the cannons currently need, weights in content.
- [x] **Flushing an empty cannon.** Unconfirmed; default: harmless, the bucket is just used up.

## 4. Board, pieces and specials

A grid deck with fixed obstacles, the barrel in the middle and a cannon at each side's mouth.
Size from content. Coordinates: `row` 0 at the bottom, like Bilging. Pieces must read without
color: powder is a cask with a grainy black texture, wad a fibrous coil, ball a dark sphere with a
highlight, bucket a banded pail with a water shimmer; each carries a mark. A piece's travel
direction shows as a small chevron on it. Each cannon shows its load as three slots filling in
order, plus a fouled state (a red crossed slot), readable by shape alone. Arrows are brass plates.
Original names: nothing here was coined; powder, wad, ball and bucket are generic.

## 5. Input

- Touch: tap a deck cell to place an arrow; tap the same cell again to rotate it through the four
  directions; drag an arrow to move it. The oldest arrow fades a little to show it goes next.
- Mouse: click to place, click again or wheel to rotate, drag to move.
- Keyboard: arrows move a cursor, `w`/`a`/`s`/`d` place an arrow pointing that way.
- Preview: hovering or holding a cell shows the path each rolling piece would take with an arrow
  there, and highlights the cannon it would reach.

## 6. Scoring

Per gun loaded: score from time on board per gun (faster is better), then a bonus for fewer
arrows placed. Integers (milliseconds from the log and counts), constants in content; the
original's exact formula is unconfirmed, so ours is published and recorded in `DESIGN.md`
section 6.

## 7. Pressure and output

- **Practice page.** Cannons fire on their own after a ready interval, so the player keeps
  reloading; speed rises during the round. Pressure is the flow of pieces and the speed.
- **Ship (M3).** Output is guns loaded per ship turn, one gun each. Guns carry over and do not
  expire, as in the original (`sea-battle.md`). The ship firing empties cannons as events in the
  move log, and a fired cannon needs a bucket before it reloads.
- **Units and clamps.** A cannon holds one load; there are four. A crew therefore holds at most
  four ready guns per gunner, and loading a ready cannon is impossible, not wasted. That bounds
  banking.

## 8. Time

Real time: pieces roll on their own. Uses the Sailing time model (timestamps on moves, `t` on
every move, server clock checks) and its ADR. The engine advances piece positions for the elapsed
time between moves on a fixed internal step, so replay is exact.

## 9. Client-only timing costs

None. Piece speed is a rule and lives in the engine.

## 10. Moves and reports

Moves: `arrow {t, col, row, dir}`, `moveArrow {t, from, to}`, `end`. Pieces move on their own in
the engine, so the client also logs `sync {t}` at a fixed interval while nothing else happens
(interval in content), giving the server a heartbeat for its clock checks. A report carries, for
the elapsed time, each piece's path segment, turns, collisions, dumps, and every cannon event
(loaded slot, fouled, flushed, ready, fired), so the renderer plays exactly what the engine
computed.

## 11. Exploits

- **Banking guns:** bounded by four cannons.
- **Arrow spam:** at most three, and fewer arrows score better.
- **Time dilation:** closed by the server clock checks.
- **Stalling:** pieces keep rolling and the clock runs.

## 12. Feedback plan

- Pieces roll with a rumble that varies by type; clank and spark on a turn off an obstacle.
- A slot fills with a distinct sound per item; a complete load rams home, the gun runs out and a
  puff of smoke rises.
- A fouled cannon fizzles and its slots cross out; a flush hisses with steam.
- Callouts for loading two cannons within a moment of each other, and for all four ready at once.
- Streak milestones for consecutive correct pieces.
- Pressure feedback: an empty cannon's port glows; one about to fire in practice ticks.
- An arrow placed where no piece will cross it soon makes a quiet click.
- Ambient: drifting smoke, a lantern sway.
- Sound fires on on-screen events. Reduced motion respected. Hint (an arrow placement that sends
  the next piece to a cannon that wants it) in unrated practice only.

## 13. Layout

Portrait. Phone: top bar holds back, score, time, guns ready and mute; the deck takes the rest,
with cannons on its edges as part of the board. Desktop: board left, HUD and legend in a sidebar.

## 14. Content

`gunnery.json`: deck size and obstacle layouts, barrel bag weights, piece speed curve, arrow cap
(3), practice firing interval, sync interval, time tolerances, scoring constants, round seconds,
item textures and marks, rating thresholds.

## 15. Tests

Determinism with timed logs; piece movement over one long gap equals movement over many short
gaps; piece conservation (every piece ends in a cannon, dumped, or on the deck); a cannon never
holds more than one load; the turn rule (right, else left, else reverse) and collisions; report
agreement; view-equals-engine smoke check.

## 16. Open questions

None open.

Decided by the owner:

- No fixed redesign trigger; the owner decides after playing it with testers.
