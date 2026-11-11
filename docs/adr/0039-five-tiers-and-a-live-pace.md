# 0039. Five tiers, and every board shows the tier being played at

Status: Accepted. Builds on [0015](./0015-puzzle-registry.md), [0019](./0019-boards-package-and-harness-bench.md)
and [0028](./0028-standing-is-earned-in-the-game.md).

## Context

A round's score means nothing across puzzles: par is 200 at Engines and 2200 at Gunnery, so a
number on a HUD tells a player nothing about how they are doing. What does carry across is the
tier a score falls in. There were seven of those (Greenhorn, Spaceworthy, Steady, Sharp, Expert,
Elite, Legend), more than a player can hold apart, and a round only named its tier once it was
over: the harness's result card, and a change of standing in the game.

## Decision

1. **Five tiers, each an adjective.** `rating-tiers.json` holds Green (0), Steady (1300), Sharp
   (1600), Masterful (1900) and Legendary (2200). An adjective reads in a sentence ("a Sharp
   round", "playing at Masterful pace") where a mix of nouns and adjectives did not. Greenhorn,
   Spaceworthy, Expert, Elite and Legend are gone. The same five name a round's own tier
   and a pirate's standing. Thresholds are untouched: each puzzle still pins six scores to the
   ratings 1100 to 2100, and a tier's line falls on that scale, so Steady starts at a puzzle's
   second threshold, Masterful at its fifth, and Legendary past its last.
2. **A round leads with its tier.** Every result card (the harness's, a station's, the captain's,
   the melee's) names the round's tier above its score, from the `performance` the server already
   sends with every scored round.
3. **A live tier on every HUD.** While a round runs, the HUD shows the tier the player is playing
   at right now: the points made in the last `paceSeconds` of the round, read as a whole round at
   that pace (`paceScore` in `engine`), rated against the puzzle's thresholds and placed in a tier
   as any score is. It is drawn as five rising pips, filled up to the tier, with the tier's name,
   so it reads without color (rule 6).
4. **`paceSeconds` is content, per puzzle.** Ten seconds by default. A puzzle that scores in lumps
   (a seal, a constellation, a turn of a fight) takes a longer stretch, about two of its scoring
   events, or the reading would sit at the bottom and jump to the top.
5. **A fight's pace is its rate.** Swordfighting's score is already an attack a minute with a band
   for a win, so its pace is the rate over the stretch in a fight that is won
   (`swordfightPaceScore`): the thresholds above the second are set for wins.
6. **One hook and one component in `boards`** (`useTierPace`, `TierPace`), used by the harness's
   practice shell and the game's station, battle and melee bars. The hook keeps samples on the
   round's own clock where there is one, so a slowed or paused lab round reads true. Every sum is
   an engine function; `boards` still computes no score.
7. **Display only.** The live tier is never sent, stored or read back. Standing still moves only
   through `updateRating` on the game's whole rounds (ADR 0028), and the ship is still paid by
   percent of par (ADR 0030).

## Consequences

- Ratings in the database are numbers and need no migration. A pirate's displayed standing
  changes name: Greenhorn reads Green; Spaceworthy reads Green below 1300 and Steady from it; the
  top fifty points of Steady (1600 to 1649) read Sharp; Expert reads Sharp below 1900 and Masterful
  from it; Elite reads Masterful below 2200 and Legendary from it; Legend reads Legendary. The
  standing titles ask for Sharp, which now starts at 1600 where it started at 1650.
- A new pirate (1500) still starts at Steady.
- The live tier is jumpy by nature: a short stretch of a lumpy puzzle is not a round. The stretch
  lengths are first guesses, to be set from play.
- What the ship and the purse take from a round is still the raw score against par. Moving those
  onto tiers is a separate decision.

## Alternatives considered

- **Letter grades beside the tiers.** A second ladder of names for the same thing.
- **One stretch length for every puzzle.** Ten seconds reads Cooling well and Plating as noise.
- **A smoothed average.** Steadier, but it answers "how has the round gone", which the score and the
  result already do; the indicator is meant to answer "how am I playing now".
