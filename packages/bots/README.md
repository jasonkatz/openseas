# Bots

The bot runner (ADR 0067, M11): bots that play any prototype engine and print its ladder table.

```
pnpm --filter @openseas/bots ladder <puzzle|all> [--seeds 32] [--stage lines,full] [--bot "one move,rollout"] [--set key=value] [--json]
```

Every bot plays every stage of the puzzle from its content file over the same seeds. Each cell is
the mean score and the tier it reads as against that stage's thresholds. Under the table are the
scores each tier starts at, and two checks: careless play lands a tier below plain play on every
stage (rule 17 of the `puzzles` skill), and each bait loses on the whole puzzle (rule 26).
`--set` lays a number over every stage so you can try it before writing it into content.
Progress goes to stderr.

- `src/core.ts`: the round driver, the `BotGame` seam, and the three bots every puzzle gets:
  careless, one move, and rollout. Rollout plays on with the engine's stream reseeded, so it never
  sees what will be dealt.
- `src/games/<id>.ts`: one file a puzzle. It gives the puzzle's choices, a person's pace (from its
  tuning notes), its end, its own bots and its baits.
- `src/ladder.ts`: the table and the checks.

The bots are not people. Their pace is a model, and they see every line on the board in the time
it takes a person to find one. The table gives a first guess and a check on the rules.
Thresholds stay the owner's to set by hand.

## The first table

The first run, at 32 seeds a cell, before any M11 puzzle beyond Salvage was deepened. The whole run
took 14 minutes on four cores; Salvage's rollout bots take most of it. The checks that fail are
listed as broken, not tuned around.

### Salvage

32 seeds a cell; a person's pace modelled as 45 hauls in 120 s. Each cell is the mean score and the tier it reads as on that stage.

| Bot | Lines (60 s) | Streak (90 s) | Nets (120 s) | Full (120 s) |
|---|---|---|---|---|
| careless | 467 Sharp | 652 Steady | 1,305 Steady | 1,529 Steady |
| one move | 1,388 Legendary | 3,286 Legendary | 9,369 Legendary | 9,153 Legendary |
| rollout | 1,897 Legendary | 4,815 Legendary | 14,434 Legendary | 15,309 Legendary |
| patient netter | 1,393 Legendary | 3,251 Legendary | 9,369 Legendary | 8,311 Masterful |
| defuse at once | 1,873 Legendary | 4,773 Legendary | 14,043 Legendary | 14,115 Legendary |
| *Steady from* | *120* | *280* | *779* | *849* |
| *Sharp from* | *355* | *799* | *2,247* | *2,447* |
| *Masterful from* | *700* | *1,599* | *4,397* | *4,796* |
| *Legendary from* | *1,225* | *2,798* | *7,695* | *8,394* |

- **careless**: Takes any choice at random.
- **one move**: Takes the choice worth most now and looks no further.
- **rollout**: Tries the 8 best choices, each played on 5 decisions 3 times on a fresh random stream, and takes the best on average.
- **patient netter**: Blind to orders and volatiles: the longest open line, and a net only when the field holds its most crates.
- **defuse at once**: The rollout bot, but a volatile on the field is defused by the first line that can reach it (the bait).

Checks:

- met: lines: careless (sharp, 467) lands a tier below one move (legendary, 1388)
- met: streak: careless (steady, 652) lands a tier below one move (legendary, 3286)
- met: nets: careless (steady, 1305) lands a tier below one move (legendary, 9369)
- met: full: careless (steady, 1529) lands a tier below one move (legendary, 9153)
- met: full: the bait "defuse at once" (14115) loses to "rollout" (15309), 7.8 percent under

### Overload

32 seeds a cell; a person's pace modelled as a tap every 1.5 s, or when one comes back. Each cell is the mean score and the tier it reads as on that stage.

| Bot | Full (120 s) |
|---|---|
| careless | 978 Green |
| one move | 3,511 Sharp |
| rollout | 3,571 Sharp |
| any 3 | 2,357 Steady |
| biggest clump | 2,668 Sharp |
| charge to four | 5,462 Masterful |
| one charge ahead | 5,100 Masterful |
| greedy charge | 2,144 Steady |
| *Steady from* | *1,199* |
| *Sharp from* | *2,498* |
| *Masterful from* | *4,497* |
| *Legendary from* | *7,495* |

- **careless**: Takes any choice at random.
- **one move**: Takes the choice worth most now and looks no further.
- **rollout**: Tries the 8 best choices, each played on 5 decisions 3 times on a fresh random stream, and takes the best on average.
- **any 3**: Taps any capacitor at 3; with none, charges one at random.
- **biggest clump**: Taps a 3 in the biggest group of touching 3s; with none, charges one at random.
- **charge to four**: Follows the idle hint: the longest chain, or a charge first when no tap reaches four.
- **one charge ahead**: Sets off the longest chain once it reaches four, unless one charge adds 70 points; else charges for the longest next chain.
- **greedy charge**: One charge ahead, but charges for any gain of 20 points (the bait).

Checks:

- met: full: careless (green, 978) lands a tier below one move (sharp, 3511)
- met: full: the bait "greedy charge" (2144) loses to "one charge ahead" (5100), 58 percent under

### Deflectors

32 seeds a cell; a person's pace modelled as 0.8 s a flip, 6 s a beam to see the long way round. Each cell is the mean score and the tier it reads as on that stage.

| Bot | Full (120 s) |
|---|---|
| careless | 592 Steady |
| one move | 3,905 Masterful |
| rollout | 3,986 Masterful |
| joiner | 1,282 Sharp |
| longest | 3,463 Masterful |
| lengthener | 624 Steady |
| *Steady from* | *400* |
| *Sharp from* | *1,149* |
| *Masterful from* | *2,598* |
| *Legendary from* | *4,697* |

- **careless**: Takes any choice at random.
- **one move**: Takes the choice worth most now and looks no further.
- **rollout**: Tries the 8 best choices, each played on 5 decisions 3 times on a fresh random stream, and takes the best on average.
- **joiner**: Joins each beam's line to the way back from its exit, 0.8 s a flip, and fires once every beam is home.
- **longest**: Takes the best setting the search finds, 6 s a beam to see it, and fires.
- **lengthener**: The joiner, but once every beam is home it tries 3 flips for a longer route before it fires (the bait).

Checks:

- met: full: careless (steady, 592) lands a tier below one move (masterful, 3905)
- met: full: the bait "lengthener" (624) loses to "joiner" (1282), 51.3 percent under

### Reactor

32 seeds a cell; a person's pace modelled as 110 swipes in 120 s. Each cell is the mean score and the tier it reads as on that stage.

| Bot | Full (120 s) |
|---|---|
| careless | 537 Green |
| one move | 2,221 Sharp |
| rollout | 3,548 Masterful |
| corner habit | 216 Green |
| planner | 3,240 Masterful |
| stacker | 3,459 Masterful |
| hoarder | 1,681 Sharp |
| *Steady from* | *600* |
| *Sharp from* | *1,598* |
| *Masterful from* | *2,998* |
| *Legendary from* | *4,947* |

- **careless**: Takes any choice at random.
- **one move**: Takes the choice worth most now and looks no further.
- **rollout**: Tries the 8 best choices, each played on 5 decisions 3 times on a fresh random stream, and takes the best on average.
- **corner habit**: Down when it can, then left, then right, and up last, blind to ports and lamps.
- **planner**: Looks three swipes ahead on fresh streams, weighing points, room, hot rods at ports and the lamps.
- **stacker**: The planner, but a hot rod at a port is held for a second to join it in a salvo.
- **hoarder**: Looks one swipe ahead, never sends a hot rod out alone while it has another swipe, and piles hot rods up for a salvo, blind to the lamps (the bait).

Checks:

- met: full: careless (green, 537) lands a tier below one move (sharp, 2221)
- met: full: the bait "hoarder" (1681) loses to "one move" (2221), 24.3 percent under

### Scanner

32 seeds a cell; a person's pace modelled as 2.6 s a ping and 1.4 s a lock. Each cell is the mean score and the tier it reads as on that stage.

| Bot | Full (120 s) |
|---|---|
| careless | 7 Green |
| plain player | 689 Steady |
| sweeper | 0 Green |
| random pinger | 522 Steady |
| splitter | 2,306 Masterful |
| gambler | 2,012 Sharp |
| *Steady from* | *500* |
| *Sharp from* | *1,199* |
| *Masterful from* | *2,199* |
| *Legendary from* | *3,698* |

- **careless**: Takes any choice at random.
- **plain player**: Follows the idle hint: locks a cell one ring or the fog count proves, else pings the clear cell with most fog near it.
- **sweeper**: Pings the fog cell by cell in reading order and never locks (at the person's pace, not the notes' 0.4 s a tap).
- **random pinger**: Locks any cell the plain arguments prove, else pings any cell not yet pinged, fog included, at random.
- **splitter**: Knows every placement the numbers allow, locks only a cell held in all, and pings the safe cell that splits them most evenly.
- **gambler**: The splitter, but locks the likeliest cell once it holds a contact in six placements of ten (the bait).

Checks:

- met: full: careless (green, 7) lands a tier below plain player (steady, 689)
- met: full: the bait "gambler" (2012) loses to "splitter" (2306), 12.7 percent under

### Tug

32 seeds a cell; a person's pace modelled as 60 flicks in 120 s. Each cell is the mean score and the tier it reads as on that stage.

| Bot | Full (120 s) |
|---|---|
| careless | 2 Green |
| one move | 36 Green |
| rollout | 765 Steady |
| ghost reader | 59 Green |
| novice | 575 Steady |
| steady | 1,007 Sharp |
| par route | 4,594 Legendary |
| *Steady from* | *400* |
| *Sharp from* | *899* |
| *Masterful from* | *1,799* |
| *Legendary from* | *3,298* |

- **careless**: Takes any choice at random.
- **one move**: Takes the choice worth most now and looks no further.
- **rollout**: Tries the 8 best choices, each played on 5 decisions 3 times on a fresh random stream, and takes the best on average.
- **ghost reader**: Sees one flick ahead: takes a flick that delivers, else flicks the wanted pod (three times in four) or any pod.
- **novice**: Sees the par route at par one and two nearly always, at par three under half the time, rarely at four; else plays as the ghost reader.
- **steady**: Sees the par route at par three three times in four and at four half the time; else plays as the ghost reader.
- **par route**: Plays the engine's par route for every clamp, so every delivery is clean (the notes' machine that never thinks).

Checks:

- **broken**: full: careless (green, 2) lands a tier below one move (green, 36)

### Racks

32 seeds a cell; a person's pace modelled as 70 actions in 120 s. Each cell is the mean score and the tier it reads as on that stage.

| Bot | Full (120 s) |
|---|---|
| careless | 5 Green |
| one move | 1,258 Sharp |
| rollout | 1,400 Sharp |
| blind sorter | 788 Steady |
| hint rules | 1,383 Sharp |
| planner | 1,636 Sharp |
| chain blind planner | 1,266 Sharp |
| *Steady from* | *600* |
| *Sharp from* | *1,249* |
| *Masterful from* | *2,099* |
| *Legendary from* | *3,149* |

- **careless**: Takes any choice at random.
- **one move**: Takes the choice worth most now and looks no further.
- **rollout**: Tries the 8 best choices, each played on 5 decisions 3 times on a fresh random stream, and takes the best on average.
- **blind sorter**: Sorts like onto like as the hint does but never looks at the crate; calls only when it has nothing to tidy.
- **hint rules**: Plays the board's idle hint: a shipment, room under a crate that will not fit, a tidying move, else the call.
- **planner**: Looks three actions ahead, sees the crate but not the next, calls when the racks are ready and counts the chain.
- **chain blind planner**: The planner, but every shipment is worth the same to it: it never plays for the chain.

Checks:

- met: full: careless (green, 5) lands a tier below one move (sharp, 1258)

### Cutting

32 seeds a cell; a person's pace modelled as 30 cuts in 120 s, a slab given up in 1 s. Each cell is the mean score and the tier it reads as on that stage.

| Bot | Full (120 s) |
|---|---|
| careless | 199 Green |
| one move | 1,273 Steady |
| rollout | 2,038 Sharp |
| greedy | 1,203 Steady |
| one cut ahead | 2,080 Sharp |
| best plan | 2,912 Masterful |
| *Steady from* | *799* |
| *Sharp from* | *1,599* |
| *Masterful from* | *2,499* |
| *Legendary from* | *3,698* |

- **careless**: Takes any choice at random.
- **one move**: Takes the choice worth most now and looks no further.
- **rollout**: Tries the 8 best choices, each played on 5 decisions 3 times on a fresh random stream, and takes the best on average.
- **greedy**: Takes the cut that banks most now, ties at random.
- **one cut ahead**: Greedy, with its ties broken by the most the next cut could bank on the same slab.
- **best plan**: Makes the first cut of a best plan for what is on the table, every time (the engine's hint).

Checks:

- met: full: careless (green, 199) lands a tier below one move (steady, 1273)

