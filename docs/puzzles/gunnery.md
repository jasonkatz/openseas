# Gunnery

Status: spec draft (M2, after Carpentry). The design doc flags Gunnery as the puzzle most likely
to need a redesign after playtesting (`DESIGN.md` 3.2). This spec is for the faithful version; a
redesign, if one comes, gets its own spec revision and section 6 entry.

## 1. Identity

Rhythm and sequence under fire. You are on the gun deck feeding a battery: powder, then wadding,
then shot, in order, through a board that routes them down to the guns. The pleasure is the
satisfying thump of a gun coming ready, and keeping several guns cycling at once. Motifs: black
iron, rope, smoke, sparks, the clank of shot. Loaded guns sit along the board's edge and are part
of the HUD. Sound is percussive: clanks, a ram stroke, a deep thump when a gun is ready.

## 2. Faithful core

Route powder, wadding and cannonballs through a column board into cannons, in the right order, to
load them. Correct loads feed cannon readiness. QoL: a per-cannon load-order indicator and a
highlight of which drop completes a load.

## 3. Rules to verify

- [ ] **Board and routing.** How do items travel to the guns: columns that items drop through,
  pipes, or something else? What redirects them? Confidence: low.
- [ ] **Item arrival.** Do items arrive singly or in sets, from a queue, and can you choose where
  each goes? Confidence: low.
- [ ] **Order.** Is the order strictly powder, wadding, shot? What happens to an item that
  arrives out of order: wasted, jams the gun, or waits? Confidence: medium on the order, low on
  the penalty.
- [ ] **Guns.** How many guns per board, and does a gun empty when fired (from the ship) or after
  a time? Confidence: low.
- [ ] **Hazards.** Are there pieces or events that spoil a load or block a column (water, debris)?
  Confidence: low.
- [ ] **Real time.** Does anything move on its own, or does the board wait for the player?
  Confidence: low. If anything moves on its own, the time model from `sailing.md` section 8
  applies.
- [ ] **Scoring.** Per gun loaded, per item, bonuses for loading several guns close together?
  Confidence: low.

## 4. Board, pieces and specials

Fixed once section 3 is verified. Items are the pieces and must read without color: powder is a
cask with a grainy black texture, wadding a fibrous coil, shot a dark sphere with a highlight;
each also carries a mark. Guns along the edge show their load state as three slots filling in
order, readable by shape alone. Any hazard piece is a dark tile with an icon and a label, as in
Bilging.

## 5. Input

To be fixed with section 3. Whatever the routing mechanic, a target column or route is chosen by
tapping or dragging to it (absolute, not relative), the next item is previewed, and the gun an
action would complete is highlighted before the player commits. Keyboard: arrows choose, space
commits.

## 6. Scoring

Integer formula after section 3. Recorded in `DESIGN.md` section 6 if it differs from the
original's.

## 7. Pressure and output

- **Practice page.** Guns fire on a move count (not wall time, so it stays a pure function of the
  log), emptying themselves; the player keeps as many ready as possible. Readiness over the round
  is the score's backbone.
- **Ship (M3).** Output is loaded guns per ship turn. The ship's firing empties guns as events in
  the move log.
- **Units and clamps.** A gun holds one load; loading a ready gun is wasted. So a crew cannot bank
  loads beyond the battery's size before a battle, the same rule as Bilging's floor.

## 8. Time

Turn-based unless section 3 finds something that moves on its own; then it uses the Sailing time
model and its ADR.

## 9. Client-only timing costs

None planned. If the original makes ramming a gun take time, model it the way Bilging models
underwater swaps: a content value, client timing only, no score depends on it.

## 10. Moves and reports

Moves fixed with section 3, plus `end`. A report carries each item's path through the board step
by step, each gun's load state after the move, and any load completed or spoiled, so the renderer
can show an item travelling and a gun coming ready.

## 11. Exploits

- **Banking loads:** closed by one load per gun.
- **Dumping items to cycle the queue:** if dumping exists, it costs a move or spoils something.
- **Stalling:** the clock runs.

## 12. Feedback plan

- An item's path animates step by step from the report, with a clank at each turn.
- A gun's slots fill with distinct sounds per item; a completed load rams home, the gun runs out
  and a puff of smoke rises.
- Callouts for loading two or more guns with one action, and a full-battery callout when every gun
  is ready.
- Streak milestones for consecutive correct items.
- An out-of-order item gets a clear, quick "wrong" beat (a fizzle and a shake of that gun), not a
  long animation.
- Pressure feedback: an empty gun's port glows red; a gun about to fire in practice ticks.
- Ambient: drifting smoke, a lantern sway.
- Sounds fire on on-screen events. Reduced motion respected. Hint in unrated practice only.

## 13. Layout

Portrait. Phone: top bar holds back, score, time, guns ready and mute; the guns sit along the
board's bottom edge as part of the board, since they are the goal; the load-order indicator lives
on each gun. Desktop: board left, HUD and legend in a sidebar.

## 14. Content

`gunnery.json`: board size and routing layout, item weights and queue length, gun count, practice
firing interval in moves, hazard chances, scoring constants, round seconds, max moves, item
textures and marks, rating thresholds.

## 15. Tests

Determinism; item conservation (every item ends in a gun, spoiled, or on the board); a gun never
holds more than one load; the load-cap model test; report agreement; view-equals-engine smoke
check.

## 16. Open questions

- Redesign trigger: what tester signal sends Gunnery back to the drawing board? Recommended: a
  median tester rating of "not fun" after two sessions, or a completion rate well below the other
  duties.
