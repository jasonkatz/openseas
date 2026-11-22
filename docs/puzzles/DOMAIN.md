# Puzzle domain guide

The source of truth for what a puzzle is. Its words are defined in the [glossary](./CONTEXT.md); this
guide says how they fit together. Where the code differs from this guide, the guide is the target,
and a change to either is made in step with the other.

## What a puzzle is

A **puzzle** is a set of rules played in rounds. A **round** starts from a seed and settings, takes in
moves and signals, reports events as it goes, and ends with a score that is judged as a tier. The
same seed, settings and log always make the same round.

A puzzle holds nothing from any world: no setting, no story, no picture, no sound. Three things sit
around it, and each owns what the puzzle does not.

| | What it holds | What it never does |
|---|---|---|
| **Puzzle** | Rules, round, layers and ladder, evaluation, settings, pieces, moves, events, stats, signals, text keys | Name a world thing, draw, sound, or hold a text's content |
| **Skin** | The drawings, cues and texts that dress one puzzle | Set or change a number |
| **Host** | Runs rounds, replays logs, keeps each player's standing and place on a ladder, owns the tier scale | Change a puzzle's rules or tier starts |
| **Role** | What a puzzle does in a world: wires its signals, decides whether a round counts, turns tiers and outcomes into rewards | Move a tier |

A **theme** is a set of skins, one for each puzzle, that dresses them all in one look.

> The game and the studio are hosts. A duty station aboard a ship is a role. Space is a theme. A
> puzzle dealt in the studio has a host and no role, so its rounds count for nothing.

A puzzle's id is a neutral word for its mechanic, such as `paths` or `swap`. No id, setting, event or
text key carries a word from a theme; the skin names everything a player sees.

## The round

### Starting

A round starts from a seed and settings: `start(seed, settings)`. The **settings** are a value for each
of the puzzle's settings and the set of layers that are on. The **seed** fixes the **deal**, the luck in
the round.

### Tempo

Every puzzle has one **tempo**: how its time moves.

| Tempo | Between moves | Example |
|---|---|---|
| Still | Nothing happens | Paths (Salvage): the board waits for the next path |
| Ticking | The rules move on by themselves, one tick at a time | Overload: taps come back over time |
| Turns | Nothing, until a turn's moves are resolved together | Space Battle: each side plans a turn, then both resolve |

A tick's length and a turn's length are fixed by the puzzle. They are never settings.

### Playing

Each **entry** is a move or a signal in, stamped with its time: `play(round, entry)` returns the next
round and the events the entry caused, in the order they happened.

### Endings

A puzzle declares one or more **endings**, and the first one met ends the round.

| Ending | Met when | Sized or named by |
|---|---|---|
| Clock | A length of time has passed | A setting |
| Move budget | A number of moves has been made | A setting |
| Stock | The round's fixed amount of deal has been worked through, such as five slabs | A setting |
| Fail | The rules report a state the round cannot go on from | An event |
| Outcome | One side has won | An event |

No ending is required. A puzzle without a clock lets a player take their time between moves.

### The log

The **log** is the ordered record of a round's moves and signals, each stamped with its time, closed by
a final time mark. A host replays a round from its seed, settings and log, and gets the same round
every time. The end of a round is never written into the log: it follows from the endings.

Every puzzle declares a fixed cap on the length of its log. It guards the host against a runaway
round and is never a setting.

> A round of Swap (Cooling) aboard a ship, in outline:
>
> | Time | Entry |
> |---|---|
> | 0.0 s | (start: seed and settings) |
> | 1.8 s | move: swap at a cell |
> | 10.0 s | signal in: level, 5 rows |
> | 11.2 s | move: swap at a cell |
> | 150.0 s | final time mark: the clock ending is met |

### Reading

`read(round)` gives the round's score, its performance, its stats, and whether it has ended.

## What goes in

### The verb and its moves

Every puzzle is built around one **verb**, the act a new player learns first. A **move** is any act a
player makes: the verb, or a lesser act.

> Paths (Salvage): the verb is *trace*, and there is no other move. Stacks (Racks): the verb moves the
> top of one rack onto another, and *call* brings the next crate down early. Flick (Tug): the verb
> flicks a pod, and *skip* gives up the lit clamp.

A puzzle declares each move with an id, one line, and its typed fields: cell, cells, direction, piece,
number or flag.

### Settings

A **setting** is a named number a puzzle is tuned by. Each declares:

| Field | Holds |
|---|---|
| id | A neutral word |
| type | Whole number, percent, permille, list of numbers, or flag |
| default | The number the puzzle ships with |
| min, max | The bounds every host holds it to |
| line | One plain sentence on what it does |
| group | Board, deal, tempo or scoring |

The default is the only place a setting's number lives. A setting a layer brings exists only while
that layer is on.

> `kinds`: whole number, default 5, from 2 to 8, "kinds dealt; more makes long paths harder to find",
> group board.

### Signals in

A **signal in** is a value from outside the puzzle that steers what it does. It is never a move, but
the log keeps it, so a replay sees it. Each declares an id, a type (number, flag or outcome) and when
it flows (on change, sampled, or at the end).

> Swap (Cooling) takes `level`, a number on change: how many rows of the board are overheated. While
> a role wires it, the puzzle stops moving the line itself.

## What comes out

### Events

An **event** is something the rules report happened. A puzzle declares each with an id, one line, and
its typed fields: cell, cells, piece, player, number or points. Every number a player sees counted on
the board arrives on an event, so nothing outside the rules works out a score.

> Paths' `loop`: "a closed path took every prize", carrying the path's cells, the cells inside it, the
> number of prizes and its points.

A round's start, its countdown and its end are the host's, the same for every puzzle. A puzzle
declares only its own events.

### Points and score

**Points** are what one event adds. The **score** is the sum of a round's points, and it never goes
below zero.

### Stats

A **stat** is a count the rules keep about a round, shown when it ends: the longest path, loops closed.

### Signals out

A **signal out** is a value the puzzle gives to whatever is outside it. The two common ones are the
**outcome** of a round played between sides, sent at the end, and the puzzle's **pace**, sampled when a
role asks for it.

> A duty station reads its puzzle's pace at every ship's turn. A boarding fight reads its puzzle's
> outcome once.

## Pieces

A **piece** is a thing on the board that the rules know by its id.

- A **family** is a numbered set of interchangeable pieces. A setting decides how many of its **kinds**
  are dealt.
- A piece can be in one of several **states**: named forms, or a count it shows.
- A piece can mark another: it is that piece, with its own states on top.

> Paths declares `kind`, a family counted by `kinds`; `prize`; `timed`, which marks a kind and counts
> the moves its fuse has left; and `ruined`.

## Depth

### Layers

A **layer** is a named group of rules that is either on or off. It brings the pieces, events and
settings that exist only while it is on. What a layer's rules cause elsewhere, such as a par rising
because there is more to plan around, is not the layer's concern.

### The ladder

A **ladder** is a puzzle's stages in order. It has two to four stages; each layer is added by exactly
one stage; no stage switches a layer off; and the last stage, `full`, is the whole puzzle.

A **stage** is its layers and one **threshold**: the bar a player clears to move to the next stage. The
threshold's measure is one of:

| Measure | Counted in |
|---|---|
| Best round at this stage | Points |
| Average of the last few rounds at this stage | Points |
| Wins over the stand-in at this stage | Wins |
| Rounds played at this stage | Rounds |

The host keeps each player's place on a ladder, and a player only moves forward. A strong player
clears a threshold sooner; a struggling one stays until ready. Only rounds of the whole puzzle build
standing.

> Paths' ladder:
>
> | Stage | Adds | Threshold |
> |---|---|---|
> | paths | paths | Best round of 120 points |
> | streak | streak, prizes | Best round of 280 points |
> | loops | loops, bounty | Best round of 780 points |
> | full | timers | |

## Judgement

### Tiers and performance

Every round is judged in one of five **tiers**: Green, Steady, Sharp, Masterful and Legendary. The
tiers are the same for every puzzle, and the scale under them is the host's.

A solo puzzle declares its **tier starts**: the score at which Steady, Sharp, Masterful and Legendary
begin. A round's **performance** is its score placed on the shared scale through those tier starts,
in straight lines between them. No host or role can move a puzzle's tier starts.

> Paths' tier starts: Steady 850, Sharp 2450, Masterful 4800, Legendary 8400.

**Pace** is performance over the recent stretch of a round, read while it is played. The puzzle
declares its **pace window**, the length of that stretch: about two of its scoring events.

### Standing

A player's **standing** at a puzzle is their level across rounds, built from their performances and
shown as a tier. The host keeps it. Solo and versus rounds build it on the same scale.

### Versus

A round played between sides is judged by its outcome, weighted by the opponent's standing: beating a
stronger opponent earns more. Its performance is the opponent's standing, one tier up for a win or one
down for a loss.

> Beating a Sharp opponent is a Masterful round. Losing to a Steady stand-in is a Green one.

## Sides

A puzzle played between sides declares how many **sides** a round has and how many **seats** each holds,
as a least and a most. An **opponent** is whoever holds a seat on another side. A **stand-in** is an
opponent the rules play themselves, in a seat no player holds. A puzzle has one stand-in for now, with
a standing set by hand.

Opponents, and everything they do to each other, are inside the puzzle. An attack from one board to
another is part of the rules, not a signal.

## What a player sees

A player sees everything the rules know about the board. Nothing on it is hidden. What the deal brings
next may still be luck.

A puzzle may offer **teaching**, and declares whether it does:

- A **preview** tells what a move would do before it is made.
- A **hint** offers a move worth making to a player who is stuck. A round that counts never hints.

## The skin

A **skin** dresses one puzzle with looks and sound, and never sets a number: not even how many kinds a
board deals.

- **Drawings.** Every piece has a **drawing**, made of shapes on a 24-unit square. A piece with named
  states has one for each; a count is drawn by repeating one layer of the drawing. A family needs a
  drawing for every kind its setting allows.
- **Cues.** The skin holds its own copy of every **cue** it plays, each a short synthesized sound in the
  one scale of the brand book. A new skin starts from a copy of the game's cues.
- **Events.** For each event, the skin names the cues it plays, which may be none. It gives the
  **beat** to exactly one event. It also voices the host's start, countdown and end.
- **Texts.** The skin holds a **text** for every key the puzzle declares, keeping that key's
  placeholders.

Every puzzle declares these text keys, and may declare more:

| Key | The text |
|---|---|
| `name` | The puzzle's name |
| `how_to` | How to play |
| `stage.<id>`, `stage.<id>_intro` | Each stage's name and its one-line card, `full` included |
| `piece.<id>` | Each piece's name |
| `event.<id>` | An event's **callout**, for each event that has one |
| `stat.<id>` | Each stat's label on the result |

## The two documents

Each puzzle is two documents: the **puzzle** and its default **skin**. A host reads both when it runs a
round. The rules are the only part of a puzzle that is code.

### The puzzle

```json
{
  "id": "a neutral word for the mechanic",
  "mechanic": "one line, plain English",
  "verb": "the id of the move the puzzle is built around",
  "round": {
    "tempo": { "kind": "still | ticking | turns", "tickMs": "ticking only", "turnSeconds": "turns only" },
    "ends": [{ "by": "clock | budget | stock | fail | outcome", "setting": "what sizes it", "event": "what names it" }],
    "logLimit": "the fixed cap on the log"
  },
  "opponents": "absent when solo, or { sides, seatsPerSide: [least, most], standIn: { standing } }",
  "settings": [{ "id": "", "type": "", "default": "", "min": "", "max": "", "line": "", "group": "board | deal | tempo | scoring" }],
  "layers": [{ "id": "", "rule": "one line", "brings": { "pieces": [], "events": [], "settings": [] } }],
  "ladder": [{ "stage": "", "adds": ["layer ids"], "advance": { "measure": "best-round | average-of-last | wins-over-stand-in | rounds-played", "threshold": "in the measure's unit" } }],
  "evaluation": { "tierStarts": "solo: { steady, sharp, masterful, legendary }", "by": "versus: outcome", "paceWindowSeconds": "" },
  "signals": { "in": [{ "id": "", "type": "number | flag | outcome", "when": "on-change | sampled | at-end" }], "out": [] },
  "pieces": [{ "id": "", "family": "the setting that counts its kinds", "of": "the piece it marks", "states": "names, or { count }" }],
  "moves": [{ "id": "", "line": "", "fields": { "<name>": "cell | cells | direction | piece | number | flag" } }],
  "events": [{ "id": "", "line": "", "fields": { "<name>": "cell | cells | piece | player | number | points" } }],
  "stats": [{ "id": "", "line": "" }],
  "texts": [{ "key": "", "placeholders": [] }],
  "teaching": { "preview": "true or false", "hint": "true or false" }
}
```

### The skin

```json
{
  "puzzle": "the puzzle's id",
  "pieces": { "<piece id, or family_kind>": "a drawing, or one per named state, or a drawing with a count layer" },
  "cues": { "<name>": "a whole cue" },
  "events": { "<event id, or start | countdown | end>": { "cues": ["cue names"], "beat": "true on exactly one event" } },
  "texts": { "<key>": "the text, keeping the key's placeholders" }
}
```

### A puzzle is ready when

- Every part of the puzzle is filled in.
- The ladder has two to four stages, each layer is added by exactly one, and the last is `full`.
- The rules know every layer, setting, piece, state, move, event and signal the puzzle declares, and
  declare nothing it lacks. A host checks this before it runs a round.
- The skin has a drawing for every piece, state and kind, a cue for every cue an event names, a text
  for every key with its placeholders kept, and the beat on exactly one event.

A puzzle that is not ready can still be edited and dressed. A puzzle with no rules yet cannot be
played.

### Example

Paths, which the space theme calls Salvage, is written out in full in two files:
[the puzzle](./examples/paths.puzzle.json) and [its skin in the space theme](./examples/paths.skin.json).
An excerpt of the puzzle:

```json
{
  "id": "paths",
  "mechanic": "Draw a path through touching pieces of one kind to clear them",
  "verb": "trace",
  "round": { "tempo": { "kind": "still" }, "ends": [{ "by": "clock", "setting": "roundSeconds" }], "logLimit": 600 },
  "layers": [
    { "id": "loops", "rule": "a closed path takes every prize at once",
      "brings": { "events": ["loop"], "settings": ["loopMin", "loopPercent", "insidePoints", "prizeLoopPoints"] } }
  ],
  "moves": [{ "id": "trace", "line": "draw a path through touching pieces, closed or open", "fields": { "cells": "cells", "closed": "flag" } }],
  "events": [{ "id": "loop", "line": "a closed path took every prize", "fields": { "cells": "cells", "inside": "cells", "prizes": "number", "points": "points" } }],
  "evaluation": { "tierStarts": { "steady": 850, "sharp": 2450, "masterful": 4800, "legendary": 8400 }, "paceWindowSeconds": 10 }
}
```

## Not yet covered

- **Layout:** the board's geometry, how a move is made by touch and keys, and settings with a shape of
  their own, such as a deck's map.
- **Motion:** how each event plays on the board, and how the beat looks.
- **Scoring:** how the rules work points out from events, with their curves, multipliers and streaks.
