# Forging

Status: built. Prototype (ADR 0036, ADR 0083), in the studio at `/play/forging`. Untimed: the
round ends when the plate is set or the press has nowhere to land, and no clock is shown.

Forging is a successor, not one of the game's own new designs: it follows the original's
Blacksmithing, the crafting puzzle in which a hot piece of metal is struck square by square and each
square's symbol says where the hammer may land next (DESIGN.md section 3 lists crafting puzzles as
explicitly later). It keeps that puzzle's mechanics and gives everything a player sees and hears its
own form: its own names, its own marks and drawings, its own sounds and numbers. Where it departs
from the original is listed in DESIGN.md section 6.

## The puzzle

A plate glows on the anvil in the ship's forge, and the player works the press. The plate is six by
six spots.

- **The verb is a strike.** Tap a spot the press can reach. It loses one of its three blows
  (`blows`); a spot with none left is **set**, an empty dot the press can no longer land on. Setting
  the whole plate (108 strikes) ends the round.
- **Marks.** Every live spot shows a mark, and the mark struck says where the next strike may land:
  - a **step** of one, two, three or four: exactly that far in a straight line, any of the eight
    ways, jumping whatever is between;
  - a **rail**: the spot on the plate's edge along its row or column;
  - a **slant**: the spot on the plate's edge along either diagonal;
  - a **star**: a rail and a slant at once;
  - a **hook**: two along and one across;
  - a **spark**: any live spot but its own.

  The first strike of a round lands anywhere. A target must be live.
- **The deal.** A struck spot that is still live turns up a new mark at once. Marks are drawn by
  weight (`weights`) from one stream in a fixed order whatever the player strikes, so the next ones
  are known: the strip over the plate shows three (`preview`). A step too long to land anywhere from
  the spot it is dealt to, even on an empty plate, is cut to the longest step that lands
  (`forgingFitMark`): on a six by six that is a four in the middle four spots, which turns up a
  three. Such a spot was a dead end whatever the player did (the owner's call from play).
- **Sparks.** The last spot at the plate's highest heat, struck and still live, shows a spark
  instead of a drawn mark: once when the whole plate has been struck once, again when it has all
  been struck twice.
- **Stalls.** A strike that leaves the press nowhere to land is a stall, and the round ends on it,
  as the original's session does. The strike scores; every blow left on the plate is score never
  made. The owner's call, against rule 8 (ADR 0083 decision 3).

## Scoring

- **How far into the plate.** The n-th strike of the round scores `strikePoints` × n (1 × n), so
  each strike is worth more than the one before, and a set plate adds `platePoints` (500). A whole
  plate is 5,886 + 500; five strikes short of it is 5,356. This is most of any score: the owner's
  call, so that how far the player got is what the round says.
- **Chains.** The same mark struck as the strike before builds a chain; a spark stands in for any
  mark. The n-th strike of a chain adds `chainPoints` × (n − 1), the step capped at `chainCap`: 10,
  20, then 30 a strike.
- **Sets.** Four strikes in a row holding each step once (one, two, three and four, in any order)
  are a **count**. Four holding rail, slant, star and hook once each are a **span**. A spark fills
  any slot. A set scores `setPoints`, 50. A mark that repeats, or one of the other kind, ends the set
  in the making and starts the next from that strike.
- **Weaves, the compound move.** A set begun on the very strike after a set of the other kind links
  to it. The k-th set of a weave scores 50 × k, k capped at `weaveCap` (5). Weaving counts and spans
  is the bonus the puzzle pays most for: it takes planning four strikes at a time, ending one set where
  the press can begin the other, and a new player would not find it by accident.

## Luck and skill

Luck: the opening plate, and the marks dealt as spots are struck, drawn by weight from the seed's
stream. It is bounded: every mark has the same odds all round, and the next three are shown. The
stream does not depend on play, so a strike never changes what comes next, only where it lands.

Skill, in the order a player learns it:

1. **Keep the press moving.** Look where a mark lands before striking it, and do not strike a spot
   whose mark reaches nothing live. Spread strikes over the plate so hot spots are left to land on.
2. **Read the preview and the edges.** Rails, slants and stars only land on the edge, so edges are
   spent on the marks that need them; the preview says what the next strike will turn up.
3. **Build sets on purpose.** Plan four strikes ahead along the lit spots, choosing between a chain
   (a little every strike) and a set (more, all at once).
4. **Weave and shape the endgame.** End a count where a span can begin, and leave the last spots
   close enough together, with a spark in hand, that the press never runs out of places to land.

What is luck and what is skill, in one line: the deal gives the marks; where the press goes, and
which spot turns them up, is the player's.

## The ladder

Cut from the whole puzzle by switching layers off (ADR 0066), the original's own order:

| Stage | What is on | Layers off |
|---|---|---|
| Steps | Steps of one, two and three; chains | `jumps`, `far`, `sparks`, `setPoints: 0` |
| Jumps | Rails, slants and hooks join | `far`, `sparks`, `setPoints: 0` |
| Sets | Steps of four and stars; counts, spans and weaves | `sparks` |
| Full plate | Sparks | |

Each stage has its own thresholds in content; every stage is the same untimed plate.

## Input and feedback

- **Tap a spot to strike it.** Keyboard: arrows or WASD move the cursor, Space or Enter strikes. A
  spot the press cannot reach is refused: a bump and a brief danger ring, nothing struck.
- **What can be reached is always drawn.** Every spot the press can land on is ringed in cream and
  every other live spot is faint. The press itself, the spot last struck, is framed in amber. The
  struck spot turns up its new mark at once, so the mark that was struck, the one the rings follow,
  is shown framed in amber at the strip's right end. Before the first strike nothing is ringed:
  every live spot is open.
- **Heat reads without colour.** A spot's tile shrinks a step with each strike (full, then about
  three quarters, then about two thirds), and colour follows as a second cue: rust, sand, sky. A set
  spot is the kit's empty dot.
- **A strike plays in under a fifth of a second (170 ms), then the next strike is open:** the tile squashes and comes back a step smaller with its
  new mark, a pop pitched by the blow, the points pop up. A chain shows its count in the strip; a
  set is called out (Count, Span) with a good chime; a stall is called out in danger (Out of
  moves) and ends the round; an earned spark is called out with a zap; a set lost is a quiet note. The beat is for a
  weave's second set or later (stronger with each link) and for the plate set.
- **Hints.** In a practice round, after six idle seconds a strike worth making breathes in a thicker
  cream ring: the one that scores most now without stalling.
- **No clock.** The page shows no time and no live tier pace, since a pace reads points over time.
  The round's `roundSeconds` (1800, the most content allows) is only the server's cap on a round
  left open. The result card leads with how the round ended: Plate set, or Out of moves.

## Pieces

`boards/data/pieces/forging.json`: every mark is the same square tile with its mark cut through it,
since the rules fix the outline. One to four round pips for the steps (one in the middle, two and
three on a diagonal, four in a square), a plus for a rail, an X for a slant, an eight-spoked
asterisk for a star, an L for a hook, a four-pointed spark for a spark. Read with every piece in one
colour, each is told apart by its cut-out, and heat by the tile's size.

## Engine

`packages/engine/src/forging/`. No clock of its own: a round ends when the plate is set, on a
stall, or on `{ type: "end" }` (the server's cap). `forgingTargets` is what the board rings, `forgingUpcoming`
the preview, `forgingStrikeValue` what a strike would do, `forgingHint` the practice hint.
Determinism tests come first in `packages/engine/test/forging.test.ts`, among them that the preview
always comes true and that any line of play ends, on a set plate or a stall.

## Tuning notes

Set from bots, not people (ADR 0036). A person's pace is modelled as a strike every 2.5 seconds;
with no clock it only times the ladder.

- **A stall ends the round.** It was first a cost scaled by the plate left, with play going on; the
  owner chose the original's rule instead. Bots now strike 40 to 80 of the plate's 108 before the
  press is stuck (the planner about 80, random striking about 44), and none sets a whole plate in
  16 seeds, so setting the plate is the expert's mark.
- **Strikes rise, 1 × n.** A flat 2 a strike left a round five strikes short of a whole plate
  scoring like a middling one: chains and sets were most of it. The owner asked for the score to
  say how far the player got, so the n-th strike scores n: the last strikes of a plate are worth
  the most, five short of a whole plate is 91 percent of one, and a whole plate adds 500 on top.
  Chains and sets stay as bonuses, a few hundred a round. This leans against rule 14 (no part of
  the score paid just for playing): here reaching further is the skill, since a stall ends the
  round.
- **Sets at 50, weaves to five.** A set takes four strikes and gives up the chain, so it pays more
  than three chain steps. The planner bot makes about seven sets a plate and links two at best;
  a weave of three or more is the expert's.
- **Thresholds** sit so that random striking is Green, the one-move bot Steady on the whole puzzle,
  and the bots that plan Sharp (about 80 strikes). Masterful is a plate struck to within about ten
  strikes, Legendary a whole plate; no bot here gets that far, so those tiers want checking by hand
  once people have.

The bots of this pass, 32 seeds a cell (`pnpm --filter @openseas/bots ladder forging`). The round's
1800 seconds is the cap, not a clock: every round here ends on the board.

| Bot | Steps | Jumps | Sets | Full |
|---|---|---|---|---|
| careless | 2,654 Green | 2,612 Green | 1,683 Green | 1,683 Green |
| one move | 4,261 Steady | 2,730 Steady | 2,161 Steady | 2,156 Steady |
| rollout | 5,512 Sharp | 4,130 Sharp | 3,875 Sharp | 3,870 Sharp |
| keeper | 4,217 Steady | 3,539 Steady | 2,886 Steady | 2,886 Steady |
| chain chaser | 4,860 Sharp | 3,540 Steady | 3,236 Steady | 3,236 Steady |
| planner | 5,282 Sharp | 3,940 Sharp | 4,174 Sharp | 4,166 Sharp |
| *Steady from* | *3,196* | *2,697* | *1,898* | *1,898* |
| *Sharp from* | *4,598* | *3,598* | *3,498* | *3,498* |
| *Masterful from* | *5,798* | *4,998* | *4,998* | *4,998* |
| *Legendary from* | *6,399* | *6,498* | *6,498* | *6,498* |

- **careless**: any spot the press can reach, at random.
- **one move**: the strike worth most now.
- **rollout**: the eight best strikes, each played five strikes on, three times, on a fresh stream.
- **keeper**: points now plus 4 for each place the press could land next, up to six; a stall is
  the worst line there is.
- **chain chaser** (the bait): strikes the same mark again whenever it can, else the keeper.
- **planner**: every line three strikes deep on the marks the preview shows; the best by points
  plus 4 a landing place at the end.

Checks: careless lands a tier below one move on every stage, and the bait loses to the planner on
the whole puzzle by 22 percent. On the whole puzzle Masterful starts about 97 strikes in and
Legendary asks for a whole plate with a few sets.

Open questions for play:

- **The sparks layer earns little with these bots.** The full plate scores only a little over the
  Sets stage. No bot here saves a spark for the endgame, which is what the layer is for.
- **The jumps layer is a harder deal, not a skill a bot shows.** Rails and slants only land on
  edges, so the Jumps stage scores less than Steps for every bot. Whether people find the edge
  discipline the skill it is in the original wants play.
- **The round ends early for everyone.** Even the planner is stuck with about a quarter of the
  plate left. If that feels harsh, the first things to try are two blows a spot (a preset) and
  more sparks.
- **Round length.** A whole plate is 108 strikes, long for rule 3; a round that ends on a stall is
  shorter, 40 to 80 strikes for the bots. Two blows a spot (a preset) is 72 strikes.
- **The pace.** A strike every 2.5 seconds is a guess for a puzzle that rewards reading ahead.
