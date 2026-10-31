# Sea Battle

Status: spec, rules from research (M4). The captain's game, played against AI brigands in v1.
Turn-based and head to head, so some Bilging lessons apply differently; each section says how.

## 1. Identity

Tactical and tense, with a reveal. The captain plans four phases of movement and fire, everyone
commits, and then the turn plays out at once: ships slide, wind shoves them, whirlpools spin them,
cannons go off, and you find out whether you read the brigand right. The pleasure is the reveal
landing the way you planned. Motifs: a chart-table sea grid seen from above, rocks, wind arrows,
wakes, cannon smoke, splash rings for misses. Sound: creaking hulls on each step, cannon booms,
splashes, a bell when planning opens. Landscape, the only puzzle that is.

## 2. Faithful core

Square grid with rocks, wind tiles and whirlpools. Each turn the captain plans four phases using
move tokens from Sailing (forward, left, right) and gun tokens from Gunnery. All ships' plans
resolve simultaneously, phase by phase: movement, then wind and whirlpools, then cannon fire and
grapples. Broadside cannons, range three. A grapple that hits ends the battle in boarding. The
ruleset is a pure reducer shared by server, client preview and AI.

## 3. Rules to verify

From research notes ([`research/original-rules.md`](./research/original-rules.md)). Confidence
after research.

- [x] **Turn.** About 35 seconds of planning, then four phases. Each phase: movement, then wind
  and whirlpools, then shots and grapples. High.
- [x] **Move tokens.** Forward, left, right; at most one per phase. Unused tokens persist but
  expire after five turns. High.
- [x] **Collision.** Each moving ship claims the tile ahead. A stationary ship there is pushed if
  it is no bigger than the rammer and the rammer moves straight; two movers claiming one tile both
  stop and both take damage. Ram damage is per ship class. High.
- [x] **Rocks and edge.** Impassable; a ship that tries stays put and takes fixed damage. Tall
  rocks block shots; short rocks do not. High.
- [x] **Wind.** Pushes a ship one tile in the wind's direction, resolved like a forward move for
  collisions. High.
- [x] **Whirlpools.** A 2 by 2 area; each phase it moves a ship to the diagonally opposite cell
  and turns it 90° clockwise, resolved like a turn for collisions; you shoot after the turn. High.
- [x] **Cannons.** Broadside only, range three, fired in step three after movement. Large ships
  fire two shots per side per phase. High.
- [x] **Gun tokens.** One per loaded cannon; they carry over and do not expire. High.
- [x] **Grapple.** Range one, one side per phase, and no cannon fire that phase. High on range,
  conflicting on whether fire is blocked for both sides or only the grappling side; recommended
  both sides (the newer rule).
- [x] **Damage into boarding.** Carries into Swordfighting as pre-filled rows. High.
- [ ] **Turn geometry.** A turn moves the ship forward then sideways into its new heading.
  Inferred; check in play.
- [ ] **Line of sight past ships.** Do ships block shots? Recommended: yes, the first ship in line
  takes the hit.
- [ ] **Queue limit.** Maximum tokens queued per turn: four phases, one move each, is the natural
  cap. Recommended.
- [ ] **Grid size.** One source says 24 by 24; recommended per-map sizes in content.

## 4. Board, pieces and specials

Grid size and terrain per map in content (one map per brigand tier to start). `y` 0 is the bottom
edge, renderers flip, the same convention as the duty puzzles. Ships face one of four directions
and have a size class. Readability without color: each side's ships carry a distinct hull shape
and sail emblem, not just a tint; tall rocks, short rocks, wind tiles (arrow glyph) and whirlpools
(spiral glyph) each have their own shape. Ship classes use generic names (sloop, cutter, brig);
the original's product names are not used.

## 5. Input

- Touch: four phase slots along the bottom; tap left, forward or right to fill the next slot, tap
  a slot's port or starboard side to add a shot or a grapple. Each planned phase shows as a ghost
  ship path on the board, including predicted wind and whirlpool moves. Drag a slot's token out to
  clear it.
- Mouse: the same, plus clicking the ghost path's sides to place shots.
- Keyboard: `a`/`w`/`d` queue left/forward/right, `q`/`e` toggle port/starboard fire for the
  selected phase, `g` grapple, backspace clears.
- The preview runs the real reducer against the opponent's current position held still, so the
  ghost path is never a guess about our own rules.

## 6. Scoring

Head to head: win (grapple to boarding, or the enemy breaks off), lose, or disengage. For booty
weighting the battle reports hits landed and damage taken per side, as integers.

## 7. Pressure and output

- **Inputs.** Move tokens from Sailing, gun tokens from Gunnery, bonuses from Navigation, each
  delivered as events in the battle log at the ship turn they were earned. Never reported by a
  client. Bilging water slows token generation through the ship model.
- **Damage.** Hits, rams and rock strikes add whole points of damage; Carpentry repairs it.
  Damage is clamped at the ship class's maximum.
- **Banking.** Move tokens expire after five unused turns (the original's rule). Gun tokens
  carry over but are bounded by Gunnery's four cannons per gunner.

## 8. Time

Turn-based. The planning clock lives on the server, which ends a turn and resolves whatever was
committed. Moves are commitments tagged with the turn number, not timestamps, so the engine stays
pure without the Sailing time model.

## 9. Client-only timing costs

None. Resolution playback length is presentation and never shortens the next turn's planning
window; the planning clock starts when playback ends on the server's schedule.

## 10. Moves and reports

Moves: `commit {turn, phases[4]: {move?, shots?, grapple?}}` per side, plus server-injected
`tokens`, `guns` and `turnEnd` events. A resolution report carries every phase in order and every
step inside it: each ship's claimed tile, collision outcome, wind or whirlpool move, end position
and facing, every shot with its path and hit or miss, grapples, and damage applied. The renderer
replays it phase by phase, step by step, the Bilging cascade lesson applied to movement.

## 11. Exploits

- **Stalling the turn:** the server clock ends it.
- **Seeing the opponent's plan:** commits stay hidden until both are in or the clock ends.
- **Hoarding move tokens:** they expire after five turns.
- **AI exploits:** the brigand policy is deterministic per seed so a reported exploit replays;
  each tier is tested against a scripted set of player tactics.

## 12. Feedback plan

- The reveal is the moment: a beat after planning closes, then phases play in order with a hull
  creak per step.
- Wind pushes show as a gust streak; whirlpools spin the ship visibly; collisions jolt and
  splinter.
- Hits throw splinters and a damage number; misses throw a splash ring; a grapple line snaps taut.
- Callouts for a double hit in one phase, a hit while taking none, and a ram.
- Your ship's damage shows on the hull and in the HUD, rising red as it nears the maximum.
- A phase in which nothing happens plays quickly.
- Ambient: rolling swell across the grid, gulls (sound only, rare).
- Sound fires on on-screen events. Reduced motion shortens playback to a fast step-through.

## 13. Layout

Landscape. Phone: the grid fills the screen; the four phase slots and token counts sit in a bar
along the bottom in thumb reach; both ships' damage sits in the top corners. Desktop: grid left;
phase slots, crew output and battle log in a sidebar.

## 14. Content

`sea-battle.json` plus brigand tiers in the world content: maps (size, rocks tall and short,
wind, whirlpools), planning seconds (35), phases (4), move-token expiry (5 turns), cannon range
(3), shots per side by class, ram and rock damage by class, ship maximum damage by class, AI
policy parameters per tier.

## 15. Tests

Determinism of resolution for any set of commits; collision rules are symmetric (swapping sides
swaps outcomes); ships never occupy rocks or leave the grid; whirlpool cycles return a ship to
its cell after four phases; tall rocks block shots and short ones do not; the AI is deterministic
per seed; preview equals resolution for the player's own moves when the opponent holds still;
view-equals-engine smoke check after each turn.

## 16. Open questions

- Turn geometry, line of sight past ships, queue limit, grid size (recommended in section 3).

Decided by the owner:

- **Practice page.** A solo battle against the lowest brigand tier with fixed token and gun
  income, so captains learn the rules before M4's voyages.
