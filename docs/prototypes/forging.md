# Forging

Status: built. Prototype (ADR 0036, ADR 0082), in the studio at `/play/forging`. Untimed moves; the
round is the plate, with a five minute clock behind it.

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
  are known: the strip over the plate shows three (`preview`).
- **Sparks.** The last spot at the plate's highest heat, struck and still live, shows a spark
  instead of a drawn mark: once when the whole plate has been struck once, again when it has all
  been struck twice.
- **Stalls.** A strike that leaves the press nowhere to land is a stall. It costs `stallCost` (300)
  times the share of the plate's blows still to strike, rounded down: 150 halfway, 27 with ten
  strikes left. The score never goes below zero. A stall breaks the chain, the set in the making
  and the weave, and the next strike may land on any live spot.

## Scoring

- **Every strike scores 2** (`strikePoints`).
- **Chains.** The same mark struck as the strike before builds a chain; a spark stands in for any
  mark. The n-th strike of a chain adds `chainPoints` × (n − 1), the step capped at `chainCap`: 10,
  20, then 30 a strike.
- **Sets.** Four strikes in a row holding each step once (one, two, three and four, in any order)
  are a **count**. Four holding rail, slant, star and hook once each are a **span**. A spark fills
  any slot. A set scores `setPoints`, 50. A mark that repeats, or one of the other kind, ends the set
  in the making and starts the next from that strike.
- **Weaves, the compound move.** A set begun on the very strike after a set of the other kind links
  to it. The k-th set of a weave scores 50 × k, k capped at `weaveCap` (5). Weaving counts and spans
  is what the puzzle pays most for: it takes planning four strikes at a time, ending one set where
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
   close enough together, with a spark in hand, that the plate is finished with few stalls.

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

Each stage has its own thresholds in content; every stage is the same five minute plate.

## Input and feedback

- **Tap a spot to strike it.** Keyboard: arrows or WASD move the cursor, Space or Enter strikes. A
  spot the press cannot reach is refused: a bump and a brief danger ring, nothing struck.
- **What can be reached is always drawn.** Every spot the press can land on is ringed in cream and
  every other live spot is faint. The press itself, the spot last struck, is framed in amber. The
  struck spot turns up its new mark at once, so the mark that was struck, the one the rings follow,
  is shown framed in amber at the strip's right end. Before the first strike and after a stall
  nothing is ringed: every live spot is open.
- **Heat reads without colour.** A spot's tile shrinks a step with each strike (full, then about
  three quarters, then about two thirds), and colour follows as a second cue: rust, sand, sky. A set
  spot is the kit's empty dot.
- **A strike plays in under half a second:** the tile squashes and comes back a step smaller with its
  new mark, a pop pitched by the blow, the points pop up. A chain shows its count in the strip; a
  set is called out (Count, Span) with a good chime; a stall is called out in danger with what it
  cost; an earned spark is called out with a zap; a set lost is a quiet note. The beat is for a
  weave's second set or later (stronger with each link) and for the plate set.
- **Hints.** In a practice round, after six idle seconds a strike worth making breathes in a thicker
  cream ring: the one that scores most now without stalling.

## Pieces

`boards/data/pieces/forging.json`: every mark is the same square tile with its mark cut through it,
since the rules fix the outline. One to four round pips for the steps (one in the middle, two and
three on a diagonal, four in a square), a plus for a rail, an X for a slant, an eight-spoked
asterisk for a star, an L for a hook, a four-pointed spark for a spark. Read with every piece in one
colour, each is told apart by its cut-out, and heat by the tile's size.

## Engine

`packages/engine/src/forging/`. No clock of its own: a round ends when the plate is set, on the
page's clock, or on `{ type: "end" }`. `forgingTargets` is what the board rings, `forgingUpcoming`
the preview, `forgingStrikeValue` what a strike would do, `forgingHint` the practice hint.
Determinism tests come first in `packages/engine/test/forging.test.ts`, among them that the preview
always comes true and that any line of play sets the whole plate.

## Tuning notes

Set from bots, not people (ADR 0036). A person's pace is modelled as a strike every 2.5 seconds, so
a plate of 108 strikes takes 270 of the round's 300.

- **Stalls cost by the share of plate left.** A flat cost per stall made the round a list of stalls:
  even a bot that searches three strikes ahead stalls about ten times a plate, nearly all in its
  last third, where few spots are left and they sit apart. Early stalls are the mistakes the
  original punishes by ending the round; late ones are close to unavoidable. Scaling the cost by
  the blows left keeps an early stall expensive (150 halfway) and a late one small, so the
  original's measure, how much of the plate was struck cleanly, is what the stall cost reads.
- **Strikes at 2.** At 5 a strike, the 108 strikes every finished plate scores were more than half
  of a good score (rule 14). At 2 they are about a fifth of a good player's gains.
- **Sets at 50, weaves to five.** A set takes four strikes and gives up the chain, so it pays more
  than three chain steps. The planner bot makes about seven sets a plate and links two at best;
  a weave of three or more is the expert's.
- **Thresholds** sit so that random striking is Green, the one-move bot Steady on the whole puzzle,
  and the bots that plan Sharp. Masterful and Legendary are left for weaves of three and more,
  which no bot here plays on purpose; those tiers want setting by hand once people have.

The bots of this pass, 24 seeds a cell (`pnpm --filter @openseas/bots ladder forging`):

| Bot | Steps (300 s) | Jumps (300 s) | Sets (300 s) | Full (300 s) |
|---|---|---|---|---|
| careless | 189 Green | 55 Green | 14 Green | 26 Green |
| one move | 1,306 Sharp | 467 Sharp | 197 Steady | 233 Steady |
| rollout | 1,393 Sharp | 505 Sharp | 602 Sharp | 654 Sharp |
| keeper | 931 Steady | 322 Steady | 118 Green | 145 Green |
| chain chaser | 1,158 Sharp | 372 Steady | 134 Green | 154 Steady |
| planner | 1,374 Sharp | 472 Sharp | 637 Sharp | 687 Sharp |
| *Steady from* | *400* | *150* | *150* | *150* |
| *Sharp from* | *999* | *400* | *475* | *475* |
| *Masterful from* | *1,599* | *800* | *900* | *900* |
| *Legendary from* | *2,199* | *1,250* | *1,499* | *1,499* |

- **careless**: any spot the press can reach, at random.
- **one move**: the strike worth most now, stall included.
- **rollout**: the eight best strikes, each played five strikes on, three times, on a fresh stream.
- **keeper**: points now plus 4 for each place the press could land next, up to six.
- **chain chaser** (the bait): strikes the same mark again whenever it can, else the keeper.
- **planner**: every line three strikes deep on the marks the preview shows; the best by points
  plus 4 a landing place at the end.

Checks: careless lands a tier below one move on every stage, and the bait loses to the planner on
the whole puzzle by 77.6 percent.

Open questions for play:

- **The sparks layer earns little with these bots.** The full plate scores only a little over the
  Sets stage. No bot here saves a spark for the endgame, which is what the layer is for.
- **The jumps layer is a harder deal, not a skill a bot shows.** Rails and slants only land on
  edges, so the Jumps stage scores less than Steps for every bot. Whether people find the edge
  discipline the skill it is in the original wants play.
- **Endgame stalls.** Even small, ten stalls in the last thirty strikes may read as noise. If it
  does, the stall's callout could be dropped below a cost.
- **Round length.** A plate is 108 strikes, about four and a half minutes at the modelled pace,
  long for rule 3. Two blows a spot (a preset) is 72 strikes; it is the first thing to try if a
  round feels long.
- **The pace.** A strike every 2.5 seconds is a guess for a puzzle that rewards reading ahead.
