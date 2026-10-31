# Swordfighting

Status: spec, rules from research plus owner decisions (M5). Head to head, real time, and the last
puzzle built. The first playable pillage resolves boarding with a stub until this ships.

## 1. Identity

Aggressive and loud: the only puzzle where another player pushes back in real time. You stack
colored blocks, fuse them into big slabs, then crack them open with a breaker to send a strike
onto your opponent's board, while their strikes pile onto yours. The pleasure is a big slab
shattering into a strike that lands on someone else, and digging out of a board they flooded.
Motifs: steel, sparks, splintered deck planks, a crowd's roar for a big hit. Callouts are combat
words of our own. Every strike is telegraphed before it lands.

## 2. Faithful core

Pairs fall into a six-wide board. Blocks do not clear on their own: a **breaker** of a color
shatters every block of its color connected to it. Same-color blocks in a 2 by 2 or larger
rectangle fuse into one big slab, which sends a far bigger strike when shattered. Strikes land on
the opponent as metal blocks that turn into ordinary blocks over a few drops. Your weapon decides
the color pattern of what you send. You lose when your spawn column fills.

## 3. Rules to verify

From research notes ([`research/original-rules.md`](./research/original-rules.md)). Confidence
after research.

- [x] **Clearing.** Breaker style, not connect-four: a breaker shatters every connected block of
  its color, and a breaker that touches more of its color after a fall breaks those too. High.
  (`DESIGN.md` said "Puyo-style"; corrected.)
- [x] **Board.** Six columns wide. High. Height unconfirmed; recommended 13.
- [x] **Losing.** When the spawn column (the fourth) fills. Medium.
- [x] **Fused slabs.** 2 by 2 or larger rectangles of one color fuse. High.
- [x] **Strike size.** A shattered 2 by 2 slab sends a 1 by 4 strike; chain steps grow it (2 by 4,
  2 by 6, …). Loose blocks shattered send single blocks, one per two shattered, breakers included.
  High on the chain scaling, medium on the singles ratio and on how bigger slabs size up.
- [x] **Strike lifecycle.** A strike lands as metal blocks that turn grey, then translucent, then
  ordinary over about three to four of the receiver's drops. Strikes never contain breakers. High.
- [x] **Weapons.** A weapon's only effect is its drop pattern, a color grid six wide and three to
  six rows tall, which colors arriving strikes. High. Our patterns are our own; the original's
  grids are not copied.
- [x] **Ship damage.** Sea battle damage pre-fills rows on the boarding board, up to six. High.
- [ ] **Counters** and **team distribution:** not found; decided by the owner (section 16).

## 4. Board, pieces and specials

Six wide by 13 tall (height from content). Coordinates as in Bilging (`row` 0 at the bottom;
pieces fall toward it here). Four block colors from the shared tile system with their own
surfaces (lacquer, steel, leather, rope) plus marks. Breakers are visibly different in shape (a
round boss on the tile), not just brighter. Fused slabs draw as one tile with a single texture
across them. Incoming strike blocks are dark metal with a countdown number, readable without
color. Names: strike singles are **shrapnel**, not the original's word; chain-tier callouts use
our own words, never the original's.

## 5. Input

As in Sailing: absolute drag to aim, tap to rotate, hold to fast-drop, swipe down to hard-drop;
the same keys. The incoming-strike preview sits above the board as the blocks about to land, with
the number of the receiver's drops until they do.

## 6. Scoring

Head to head: win or lose. For booty weighting the duel reports strike blocks sent and received
per pirate, as integers. Strike size per shatter follows section 3's rules, with constants in
content.

## 7. Pressure and output

- **Pressure** is the opponent: incoming strikes are the only external input, plus ship damage
  rows at the start of boarding.
- **Output** is strike sent.
- **Counters.** Strike you generate first cancels strike queued against you, block for block;
  only the remainder is sent.
- **Banking.** Unbroken colored blocks and slabs are a deliberate bank in this genre (building a
  big slab to break later is the skill), so it stays. The limit is board height and incoming
  pressure.

## 8. Time

Real time, using the Sailing time model and its ADR (`t` on every move, server clock checks). Two
or more boards share one duel log on the server: each player's moves are applied in `t` order, and
a strike lands on its target at the target's next drop after the sender's `t`, so the outcome is a
pure function of the merged log. This merge rule goes in the ADR.

## 9. Client-only timing costs

None. Latency is handled by the merge rule, not by delays.

## 10. Moves and reports

Moves: as in Sailing (`move`, `rotate`, `drop`, `lock`, all with `t`), plus `target {t, pirate}`
in team fights and server-injected `strike {from, pattern, size, t}`. A report carries each chain
step (blocks shattered, slabs, strike generated, strike cancelled by counter) and each strike
landing (cells filled) and conversion step, so both screens replay the exchange step by step.

## 11. Exploits

- **Lag abuse:** a player who withholds moves cannot delay strikes landing on them; landing is
  keyed to their own next drop, and the gravity lock forces drops regardless of input.
- **Time dilation:** closed by the server clock checks.
- **Infinite lock delay:** capped resets, as in Sailing.
- **Gang-targeting** in team fights is a tactic, not an exploit; a board under several attackers
  shows each incoming strike's sender.

## 12. Feedback plan

- Shatters spray sparks; each chain step plays in turn and launches a visible streak toward its
  target's board.
- Incoming strikes are telegraphed in the preview row, flash as they land, and shake the board in
  proportion; conversion ticks down visibly.
- A counter clashes: two streaks meet mid-screen with a ring of steel and its own callout.
- Callouts for big slab shatters, chain steps and a knockout.
- Danger: the spawn column glows red and the crowd noise rises as it fills.
- A drop that shatters nothing lands quietly.
- Sound fires on on-screen events. Reduced motion respected. No hints in duels; the solo practice
  page may hint.

## 13. Layout

Portrait. Phone: your board fills most of the screen; opponents show as small live boards along
the top, tappable to target in team fights, so you see what you send land. Desktop: your board
centered, opponents beside it at reduced size.

## 14. Content

`swordfighting.json`: board size, block colors with textures and marks, pair weights, breaker
chance, minimum slab size, strike formula, conversion drops, counter rule, weapon table with our
drop patterns, ship-damage row mapping, drop speed, lock delay and reset cap, time tolerances.

## 15. Tests

Determinism of the merged duel log; the same merged log replays identically on every client and
the server; strike conservation (every strike block sent lands or is cancelled); slabs fuse only
from full rectangles; lock-reset cap; view-equals-engine smoke check on each board.

## 16. Open questions

None open.

Decided by the owner:

- **Clearing.** Breaker style, faithful to the original.
- **Counters.** Strike generated cancels strike queued against you before it lands. (The original
  is unconfirmed; recorded in `DESIGN.md` section 6.)
- **Team fights.** Each fighter picks a target by tapping an opponent's board, and strikes go
  there. (The original's split is unconfirmed; recorded in section 6.)
- **Practice page.** A solo board against a scripted attacker that sends fixed patterns on a drop
  count, rated against the puzzle like the duties until real duels exist.
