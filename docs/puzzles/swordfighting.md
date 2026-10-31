# Swordfighting

Status: spec draft (M5). Head to head, real time, and the last puzzle built. The first playable
pillage resolves boarding with a stub until this ships.

## 1. Identity

Aggressive and loud: the only puzzle where another player is pushing back in real time. You build
up colored blocks and break them open to send attacks onto your opponent's board, while their
attacks pile onto yours. The pleasure is a big break landing on someone else, and digging out of
a board they flooded. Motifs: steel, sparks, splintered deck planks, a duelling crowd's roar for a
big hit. Callouts are combat words. Every attack is telegraphed before it lands.

## 2. Faithful core

Falling colored pairs on each pirate's board. Groups clear; cleared groups send attack blocks to
opponents' boards. Team mode distributes each side's attacks. QoL: an incoming-attack preview and
swipe controls.

## 3. Rules to verify

- [ ] **Clearing.** Belief: same-color blocks do not clear on their own; a special breaker block
  of a color clears the connected group of that color it touches. Confidence: medium.
- [ ] **Big blocks.** Belief: a solid rectangle of one color fuses into a single large block that
  is worth more when broken. Minimum size? Confidence: medium.
- [ ] **Attacks.** Belief: breaks send a pattern of attack blocks to the opponent, and attack
  blocks turn into ordinary blocks after a few of the receiver's pieces. Confidence: medium. The
  original's coined name for attack blocks gets an original one.
- [ ] **Attack patterns.** Belief: the pattern sent depends on the attacker's weapon. If so,
  weapons become a content table with original names. Confidence: medium.
- [ ] **Counter.** Does breaking while attacks are incoming cancel them before they land?
  Confidence: medium.
- [ ] **Losing.** Belief: a board that fills to the top loses the duel. Confidence: high.
- [ ] **Team mode.** How a side's attacks are spread over the other side's boards: targeted,
  rotating, or split. Confidence: low.

## 4. Board, pieces and specials

Fixed once section 3 is verified. Coordinates as in Bilging (`row` 0 at the bottom; pieces fall
toward it here). Block colors use the shared tile system with their own surfaces (lacquer, steel,
leather, rope) plus marks. Breakers are visibly different in shape (a round boss on the tile), not
just brighter. Attack blocks are dark tiles with a countdown number, readable without color.
Fused big blocks draw as one tile with a single texture across them.

## 5. Input

As in Sailing: absolute drag to aim, tap to rotate, swipe down to drop. Keyboard the same as
Sailing. The incoming-attack preview sits above the board as a row of the blocks about to land,
with the number of the receiver's pieces until they do.

## 6. Scoring

Head to head: win or lose. For booty weighting the duel reports attack sent and received per
pirate, as integers. Attack size per break is an integer formula of group size, fused blocks and
chain step, written after section 3.

## 7. Pressure and output

- **Pressure** is the opponent. Incoming attacks are the only external input.
- **Output** is attack sent. Attacks queue on the receiver; a counter (if verified) cancels
  queued attack before it lands.
- **Banking.** Unbroken colored blocks are a deliberate bank in this genre (building a big block
  to break later is the skill), so it stays. The limit is board height and the incoming pressure.

## 8. Time

Real time, using the Sailing time model and its ADR (`t` on every move, server clock checks).
Two boards share one duel log on the server: each player's moves are applied in `t` order, and an
attack lands on the receiver at the receiver's next piece after the attacker's `t`, so the
outcome is a pure function of the merged log. This merge rule needs to be in the ADR.

## 9. Client-only timing costs

None. Latency is handled by the merge rule, not by delays.

## 10. Moves and reports

Moves: as in Sailing (`move`, `rotate`, `drop`, `lock`, all with `t`), plus server-injected
`attack {from, pattern, t}`. A report carries each chain step (groups broken, attack generated)
and each attack landing (cells filled), so both the attacker's and the receiver's screens replay
the exchange step by step.

## 11. Exploits

- **Lag abuse:** a player who withholds moves cannot delay attacks landing on them; landing is
  keyed to their own next piece, and the gravity lock forces pieces regardless of input.
- **Time dilation:** closed by the server clock checks.
- **Infinite lock delay:** capped resets, as in Sailing.

## 12. Feedback plan

- Breaks shatter with sparks; a chain's steps play in turn and each sends a visible streak toward
  the opponent's side.
- Incoming attacks are telegraphed in the preview row, flash as they land, and shake the board in
  proportion.
- A counter that cancels incoming attack gets its own clash sound and callout.
- Callouts for big-block breaks, chains, and a knockout.
- Danger: the top rows glow red and the crowd noise rises as the stack nears the top.
- A drop that breaks nothing lands quietly.
- Sounds fire on on-screen events. Reduced motion respected. No hints: every duel is head to head.

## 13. Layout

Portrait. Phone: your board fills most of the screen; opponents show as small live boards along
the top, so you can see what you are sending land. Desktop: your board centered, opponents beside
it at reduced size.

## 14. Content

`swordfighting.json`: board size, block colors with textures and marks, piece weights, breaker
chance, minimum fused size, attack formula, attack countdown, weapon table with attack patterns,
drop speed, lock delay and reset cap, time tolerances, team distribution rule.

## 15. Tests

Determinism of the merged duel log; the same merged log replays identically on both clients and
the server; attack conservation (every attack sent lands or is cancelled); lock-reset cap;
view-equals-engine smoke check on each board.

## 16. Open questions

None open.

Decided:

- Swordfighting gets a solo practice page against a scripted attacker that sends fixed patterns on
  a piece count, rated against the puzzle like the duties until real duels exist.
