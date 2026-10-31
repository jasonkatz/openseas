# Sea Battle

Status: spec draft (M4). The captain's game, played against AI brigands in v1. Turn-based and
head to head, so some Bilging lessons apply differently; each section says how.

## 1. Identity

Tactical and tense, with a reveal. The captain plans up to four moves, everyone commits, and then
the turn plays out at once: ships slide, wind shoves them, cannons go off, and you find out whether
you read the brigand right. The pleasure is the reveal landing the way you planned. Motifs: a
chart-table sea grid seen from above, rocks, wind arrows, wakes, cannon smoke, splash rings for
misses. Sound: creaking hulls on each step, cannon booms, splashes, a bell when a turn begins.
Landscape, the only puzzle that is.

## 2. Faithful core

Square grid with rocks and wind arrows. A per-turn move-token pool from Sailing (left, forward,
right). Up to four moves queued per turn. Simultaneous resolution with collision and wind rules.
Cannon fire placed left or right per move segment. Damage from hits. Brigand AI chooses moves from
a scripted policy with difficulty tiers. The ruleset is a pure reducer shared by server, client
preview and AI.

## 3. Rules to verify

- [ ] **Collision.** When two ships want the same cell or swap cells, who moves, who stops, and is
  there ramming damage? Confidence: medium.
- [ ] **Wind.** When does a wind arrow push a ship: on entering the cell, at the end of a segment?
  Does it turn the ship? Confidence: medium.
- [ ] **Other terrain.** Are there whirlpools or other tiles that move ships? Confidence: medium.
- [ ] **Firing.** Range, line of sight past rocks, and whether shots resolve before or after
  movement within a segment. Confidence: low.
- [ ] **Cannon supply.** How many shots a turn's loaded guns allow, and whether unfired loads carry
  over. Confidence: low.
- [ ] **Grappling.** When a battle ends in boarding, and whether either side can refuse.
  Confidence: medium.
- [ ] **Turn clock.** Whether the turn length is fixed or ends early when both sides commit.
  Confidence: medium.

## 4. Board, pieces and specials

Grid size and terrain from content (one battlefield per brigand tier to start). `y` 0 is the
bottom edge, renderers flip, the same convention as the duty puzzles. Ships face one of four
directions. Readability without color: each side's ships carry a distinct hull shape and sail
emblem, not just a tint; rocks, wind and other terrain each have their own shape and mark.

## 5. Input

- Touch: tap the left, forward and right buttons to queue moves; each queued move shows as a ghost
  ship path on the board, including predicted wind pushes; tap a segment's port or starboard side
  to place a shot. Drag a queued move out of the queue to remove it.
- Mouse: the same, plus clicking on the board path to place shots.
- Keyboard: arrows queue moves, `q` and `e` toggle port and starboard fire for the selected
  segment, backspace removes.
- The preview runs the real reducer against the brigand's last known position, so the ghost path
  is never a guess about our own rules.

## 6. Scoring

Head to head: the outcome is win, lose or disengage, not a score. For booty weighting
(`DESIGN.md` 3.4) the battle reports hits landed and damage taken per side, as integers.

## 7. Pressure and output

- **Inputs.** Movement tokens from Sailing, loaded guns from Gunnery, bonuses from Navigation,
  each delivered as events in the battle log at the ship turn they were earned. Never reported by
  a client.
- **Damage.** Hits add whole points of damage; Carpentry repairs it and Bilging water slows the
  ship, both through the ship model. Damage is clamped at the ship class's maximum.
- **Banking.** Tokens unused at the end of a turn are capped (content) so a crew cannot hoard
  movement before engaging; the cap is a tuning knob, not a rules change.

## 8. Time

Turn-based. The turn clock lives on the server, which ends a turn and resolves whatever was
committed. Moves are commitments tagged with the turn number, not timestamps, so the engine stays
pure.

## 9. Client-only timing costs

None. Resolution playback length is presentation and never delays the next turn's planning beyond
the turn clock.

## 10. Moves and reports

Moves: `commit {turn, moves[≤4], shots[]}` per side, plus server-injected `tokens`, `loads` and
`turnEnd` events. A resolution report carries every segment in order: each ship's start, wind
push, collision outcome, end position and facing, every shot with its path and hit or miss, and
damage applied. The renderer replays it segment by segment, the Bilging cascade lesson applied to
movement.

## 11. Exploits

- **Stalling the turn:** the server clock ends it.
- **Seeing the opponent's plan:** commits are hidden until both are in or the clock ends; the
  server never sends one side's commit to the other before resolution.
- **AI exploits:** the brigand policy is deterministic per seed so a reported exploit replays;
  each tier is tested against a scripted set of player tactics.

## 12. Feedback plan

- The reveal is the moment: a brief beat after the turn ends, then segments play in order with a
  hull creak per step.
- Wind pushes show as a gust streak; collisions as a hard jolt and splinters.
- Hits throw splinters and a damage number; misses throw a splash ring.
- Callouts for a double hit in one segment, a hit while taking none, and a ram.
- Your ship's damage shows on the hull and in the HUD, rising red as it nears the maximum.
- A turn in which nothing happens (both ships miss and drift) plays quickly.
- Ambient: rolling swell across the grid, gulls (sound only, rare).
- Sounds fire on on-screen events. Reduced motion shortens playback to a fast step-through.

## 13. Layout

Landscape. Phone: the grid fills the screen; the token pool and move queue sit in a bar along the
bottom in thumb reach; both ships' damage sits in the top corners. Desktop: grid left, queue,
crew output and log in a sidebar.

## 14. Content

`sea-battle.json` plus the brigand tiers in the world content: grid size, terrain layouts per tier,
wind rules, cannon range, damage per hit, token carry cap, turn seconds, ship maximum damage by
class, AI policy parameters per tier.

## 15. Tests

Determinism of resolution for any pair of commits; collision rules are symmetric (swapping sides
swaps outcomes); ships never occupy rocks or leave the grid; the AI is deterministic per seed;
preview equals resolution for the player's own moves when the brigand holds still; view-equals-
engine smoke check after each turn.

## 16. Open questions

- Practice page: recommended a solo battle against the lowest brigand tier with fixed token and
  load income, so captains can learn the rules before M4's voyages.
