# 0030. Booty weighs what the ship received, and each station has its own turn cap

Status: Accepted. Supersedes how [0021](./0021-sea-battle-as-the-captains-board.md) decision 5
weights the split ("by that pirate's duty points"). Builds on
[0022](./0022-swordfight-melee-routed-by-the-server.md),
[0023](./0023-deckhands-in-the-ship-reducer.md) and
[0027](./0027-voyage-bench-sails-the-engines-as-the-server-does.md).

## Context

The owner's review of what each puzzle rewards found two problems in how a board's score reaches
the ship and the purse.

1. **The purse weighed raw points across puzzles whose par differs elevenfold.** Gunnery's par is
   2200 a round and Sailing's 200. A gunner topped nearly every split, and everyone else's share
   was scaled toward half for being at a quieter puzzle. The melee then added raw Swordfight points
   on top, which run to the thousands.
2. **One turn cap of 200% cut off the puzzles that score in lumps.** A station's output is its
   points in a 10-second turn against par, clamped, and nothing over the clamp carries. A single
   fair Carpentry patch, the smallest charted Navigation constellation, or one full-combo Gunnery
   load filled a turn by itself, so aboard, quality and combos bought the ship nothing.

The owner chose a higher cap per station with no carry-over, and booty weighted by the output the
ship actually received. A melee counts as duty turns at a pirate's attack rate against
Swordfight's par.

## Decision

1. **A cap per station.** `outputCapPercent` in the ship rules replaces `maxOutputPercent`, with one
   number per station. The first values (Bilging 1000, Sailing 350, Carpentry 1000, Gunnery 650,
   Navigation 1000) come from bots bucketed into 10-second turns. Sailing's is its strong bot's
   98th-percentile turn. Bilging's and Carpentry's 98th percentiles reach 3700% and 1000%, so a
   ceiling of 1000% bounds any one turn. Gunnery's and Navigation's come from what one good turn's
   scoring events are worth, since no bot plays them well enough. A turn that earned less than
   nothing still reads as 0.
2. **The purse weighs output received.** After each ship's turn in a fight, `turnBootyOutputs` gives
   each pirate the output of the station they held, in percent of par after the cap. Deckhands earn
   none (ADR 0023). `splitBooty` is unchanged: shares between half and full by weight against the
   best aboard, and two base shares for the captain.
3. **The melee as duty turns.** `meleeBootyOutput` takes a pirate's attack a minute (the score
   without the win band) as a percentage of Swordfight's `parRatePerMinute`, once for every ship's
   turn the melee lasted.
4. **The same functions in the server and the voyage bench**, in `engine/src/ship/aboard.ts`
   (ADR 0027). The bench's melee also takes the tier's score factor, as the server's does.

## Consequences

- A pirate at par counts the same in the purse at any station. Gunnery's scale no longer decides
  the split.
- The ship now receives more than it did: less output is cut off, so pumping, repairs and loads run
  higher, and battles go easier on a crew. The ship's own rules (intake, wear, pump, repair and load
  rates, and the speed and token ceilings that a crew at par already reaches) wait for the separate
  ship pass the owner scheduled.
- A bursty puzzle can give the ship ten turns of par in one, up to its cap, and weigh that much in
  the purse. The caps are content numbers, to be retuned once testers' recorded rounds show real
  turns.
