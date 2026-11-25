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
| **Puzzle** | Rules, round, board, pieces, deal, layers and ladder, evaluation, settings, moves, events and the board changes they carry, its moment, gauges, stats, signals, text keys | Name a world thing, draw, sound, hold a text's content, or decide where anything sits on a screen |
| **Skin** | The drawings, cues, texts and motion that dress one puzzle | Set or change a number, or change a round |
| **Host** | Runs rounds, replays logs, keeps each player's standing and place on a ladder, owns the tier scale, holds the ceiling on motion, keeps a round's secrets, measures each stand-in | Change a puzzle's rules or tier starts |
| **Theme** | A palette and type its skins name, the cues and motion a new skin starts from, its host texts, and a skin for each puzzle | Change a puzzle, or set a number a skin plays |
| **Role** | What a puzzle does in a world: wires its signals, decides whether a round counts, turns tiers and outcomes into rewards | Move a tier |

A **theme** dresses every puzzle in one look: it holds what its skins share, and a skin for each
puzzle ([Themes](#themes)).

> The game and the studio are hosts. A duty station aboard a ship is a role. Space is a theme. A
> puzzle dealt in the studio has a host and no role, so its rounds count for nothing.

A puzzle's id is a neutral word for its mechanic, such as `paths` or `swap`. No id, setting, event or
text key carries a word from a theme; the skin names everything a player sees.

## The round

### Starting

A round starts from a seed and settings: `start(seed, settings)`. The **settings** are a value for each
of the puzzle's settings and the set of layers that are on. The **seed** fixes the **deal**, the luck in
the round ([The deal](#the-deal)).

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
a final time mark. A host replays a round from its seed, settings and log, on the version it was
dealt on ([Versions](#versions)), and gets the same round every time. The end of a round is never written into the log: it follows from the endings.

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

A puzzle declares each move with an id, one line, its typed fields (place, places, direction, piece,
number or flag) and the gesture that makes it.

### How a move is made

Every move names one **gesture**, the way a player makes it by touch:

| Gesture | The player | Example |
|---|---|---|
| Tap | Taps a place or a control | Overload: tap a capacitor to charge it |
| Long press | Presses and holds a place | Scanner: a long press locks a cell |
| Draw | Draws a path through touching cells | Paths: trace a path through one kind |
| Drag | Drags from one place to another | Racks: drag the top of one rack onto another |
| Swipe | Swipes a direction, anywhere or starting on a piece | Reactor: swipe the whole core; Tug: flick a pod |
| Slice | Slices along a line of the grid | Cutting: cut a piece along a grid line |
| Turn | Turns around the board's centre | Navigation: turn a ring |
| Hold | Keeps pressing to hurry what is happening | Engines: hold to drop the pair faster |

Some moves are built **in hand** before they are made. The player takes a piece, such as a plate from a
tray or the pair that is falling, then moves, turns or flips it, and only setting it down is the move.
Adjusting what is in hand never reaches the log.

A move with no place, such as a skip or calling the next crate, is made with a **control**: a button the
puzzle declares for it. A control can also switch what a tap does without being a move itself, as
Scanner's switch between pinging and locking does.

Every puzzle is played by keys with one scheme, so no puzzle has keys of its own:

| Key | Does |
|---|---|
| Arrows or WASD | Move the cursor from place to place |
| Space or Enter | Make the gesture at the cursor |
| Escape | Let go of what is in hand |
| Digits | Pick a spot in a zone |
| Q and E | Turn what is in hand |
| F | Flip what is in hand |
| A control's own letter | Use that control |

On a grid whose cells touch by diagonals, Q, E, Z and C also move the cursor diagonally.

### Settings

A **setting** is a named number a puzzle is tuned by. Each declares:

| Field | Holds |
|---|---|
| id | A neutral word |
| type | Whole number, percent, permille, list of numbers, flag, or a list of maps |
| default | The number the puzzle ships with |
| min, max | The bounds every host holds it to |
| line | One plain sentence on what it does |
| group | Board, deal, tempo or scoring |
| unit | What it counts: seconds, ticks, moves, cells, pieces or points. Absent for a plain count, a percent, a permille or a flag |
| entries | A list only: the least and most entries, or the setting or count that fixes how many, and the bounds of each entry |
| map | Maps only: the board each map fills and the check every map must pass, such as every port reachable |
| role | True when a role may set it for a round, within its bounds. Absent otherwise |

The default is the only place a setting's number lives. A setting a layer brings exists only while
that layer is on, so switching a layer off needs no value of its own.

> `kinds`: whole number, default 5, from 2 to 8, "kinds dealt; more makes long paths harder to find",
> group board.

A puzzle also declares the **relations** its settings keep with one another, which no setting's bounds
can say alone:

| Relation | Holds when | Example |
|---|---|---|
| At most | One setting is no more than another | Paths' `startPrizes` at most `maxPrizes`, and `maxPrizes` at most `width` |
| Below | One setting is less than another | A short path's length below a long one's |
| Ascending | A list's entries never fall | A cascade table that pays more at every step |
| Fits | A count fits the board | No more pieces dealt at the start than the board has cells |

Every host holds a round's settings to their bounds and relations before it starts, so the studio and
the server refuse the same settings. A relation with a setting that a layer brings holds only while
that layer is on.

### Signals in

A **signal in** is a value from outside the puzzle that steers what it does. It is never a move, but
the log keeps it, so a replay sees it. Each declares an id, a type (number, flag or outcome) and when
it flows (on change, sampled, or at the end).

> Swap (Cooling) takes `level`, a number on change: how many rows of the board are overheated. While
> a role wires it, the puzzle stops moving the line itself.

## What comes out

### Events

An **event** is something the rules report happened. A puzzle declares each with an id, one line, and
its typed fields: place, places, piece, player, number or points, and the board changes it can carry
([Motion](#motion)). Every number a player sees counted on the board arrives on an event, so nothing
outside the rules works out a score, and every change to the board arrives on one too.

> Paths' `loop`: "a closed path took every prize", carrying the path's places, the places inside it,
> the number of prizes and its points.

A round's start, its countdown and its end are the host's, the same for every puzzle. A puzzle
declares only its own events.

### Points and score

**Points** are what one event adds, each point belonging to a payout ([Scoring](#scoring)). They go to
the seat that earned them and stop at zero as they are added, so a penalty never takes a seat's points
below it. The **score** is the sum of a round's points, and it never goes below zero. Between sides it
is the points of the player's side, unless the puzzle reads it another way
([Between sides](#between-sides)).

### Stats

A **stat** is a count the rules keep about a round, shown when it ends: the longest path, loops closed.

### Gauges

A **gauge** is a number a player watches while the round is played, besides the score: taps left, a
rising line, cuts left, a crate's countdown. A puzzle declares each gauge with an id, one line, its
most where it has one (a number or a setting), and the point past which it means danger, such as heat
past half or pings past par. `read(round)` gives every gauge's value.

> Paths watches `prizes`, the prizes on the board out of at most `maxPrizes`, and `streak`, the long
> paths in a row.

### Signals out

A **signal out** is a value the puzzle gives to whatever is outside it. The two common ones are the
**outcome** of a round played between sides, sent at the end, and the puzzle's **pace**, sampled when a
role asks for it.

> A duty station reads its puzzle's pace at every ship's turn. A boarding fight reads its puzzle's
> outcome once.

## Scoring

The rules work out every point from events. Nothing outside them adds, scales or checks a score.

### Payouts

Every point belongs to a **payout**: a named way the puzzle pays, such as a path or a loop. A puzzle
declares each payout with:

| Field | Holds |
|---|---|
| id | A neutral word |
| line | One plain sentence on what it pays for |
| on | The event or events it pays on |
| counts | The event's field it grows from: a number, or places, counted, such as a path's cells. Absent for a flat payout |
| growth | Flat, linear, superlinear or stepped |
| cap | The count past which it grows no faster, a number or a setting, absent when it has none |
| reads | The settings that size it |

A payout's **growth** says how its points rise with what it counts:

| Growth | Points | Example |
|---|---|---|
| Flat | The same every time | Paths' bounty: 200 points |
| Linear | A setting times the count | Paths' inside: 10 points for each piece inside a loop |
| Superlinear | A setting times the count squared | Paths' path: a path of n pieces scores n × n |
| Stepped | A list of points, an entry for each count, whose last entry holds | A clear of 1, 2, 3 or 4 rows paying 100, 250, 450 or 700 |

A penalty is a payout whose points are taken away. A score still never goes below zero.

An event's points are split by payout, so a round can always be broken down: what each payout paid,
and what share of the score each one made. The puzzle bar's rule that no single mechanic is the whole
round is read from that split.

A layer brings the payouts that exist only while it is on.

### Multipliers

A **multiplier** scales named payouts on an event by a percent. The percent is either a setting, or an
entry in a table: a list setting indexed by the streak or by a cascade's step.

Multipliers that meet on one event multiply together, and the result is rounded down once, for the
event, never once for each multiplier.

> Paths' loop multiplier doubles the path payout when the path closes (`loopPercent`, 200). Its streak
> multiplies every payout. A closed path of 6 on a streak at 130%: 6 × 6 = 36, doubled to 72, then 72
> × 130% = 93.6, rounded down to 93.

### Cascades

A **cascade** is everything one move sets off, such as clears that cause more
clears, or prizes that reach the floor once the pieces under them go. Each link of it is a **step**.
Every event in a cascade belongs to the move that started it, so a multiplier that holds for that move,
such as the streak, holds for the whole cascade. A table indexed by step makes later links pay more.

### The streak

A puzzle has at most one **streak**: a run of successes that raises a multiplier. It declares:

- what **builds** it: an event, with a condition on it, such as a path of five or more, or a task's
  grade, such as clean;
- its **grace**: how many **misses** in a row it forgives before it breaks, where a miss is a move or a
  task that builds nothing;
- which **mistakes** break it at once.

What it raises is a multiplier whose table is indexed by the streak: a list setting with an entry for
each success in a row, whose last entry holds.

The rules keep the round's best streak as the stat `best_streak`, and the streak's count as a gauge.

### Mistakes

A **mistake** is an event the puzzle marks as one, such as a wrong lock or a fuse that runs out. It costs
points (through a penalty payout), the streak, or both. A mistake never ends a round: an ending that
does is a fail. A player who plays well can always avoid every mistake; one that luck alone deals is
not a mistake.

### Tasks

A **task** is a unit of work the deal sets within a round, such as a slab to cut, a clamp to fill or a
posted bounty. A puzzle declares each task with:

| Field | Holds |
|---|---|
| id | A neutral word |
| line | One plain sentence on what finishes it |
| open | How many can be open at once |
| ends | Done, given up (with the control that gives it up), or out of time (with the setting that times it) |
| graded | By par, by best, or by nothing |
| grades | Its grades, in order from best, such as clean, full and slow |
| next | Dealt as soon as one is needed, or the control the player asks for the next one with, as a new hand is asked for |

**Par** is the fewest moves that can finish a task. **Best** is the most any play could score from it.
The rules work out both when the task is dealt. Par is shown to the player, as a target. Best is never
shown, since it would show what expertise takes; the player learns how well they did from the task's
grade when it ends.

A task's grade can build the streak, and a payout can pay on a task ending with a given grade.

### Difficulty

Difficulty holds for a whole round, and the stage sets it (ADR 0072). Every task in a round is dealt
from the same settings, from the first second to the last: no quicker feed, no growing target, no par
that climbs with clean play. A rule that answers play, such as heat that rises with moves and falls
with points, is not a ramp.

### Between sides

A round played between sides keeps points for each seat, and a side's points are its seats' together.
Its score is the points of the player's side, unless its rules read the score from every side's points,
the time played and the outcome, as a lead over the other side is ([The rules](#the-rules)). The puzzle
declares whether its rounds are judged by their outcome or by their score ([Versus](#versus)). No score
is scaled by the opponent's standing.

The puzzle bar's own rules for scoring, such as how long a round runs and how big a share one payout
may take, are kept in the `puzzles` skill. This guide gives the words they are checked with.

## The board

A puzzle's **geometry** is where pieces can be and which places touch. It is part of the rules. Where
the board, its zones and the score sit on a screen, and how big they are, is its **arrangement**, which
belongs to whatever draws the board and never to the puzzle.

### Shape and cells

A board is made of **cells**, and its **shape** says which cells there are and which touch.

| Shape | Size | Cells touch | Example |
|---|---|---|---|
| Grid | Width by height | On four sides, or on eight where the puzzle counts diagonals | Paths: a 7 by 8 grid touching on eight |
| Rings | Rings by sectors | Around a ring, and in and out along a sector | Navigation: 3 rings of 8 sectors |

Every board counts its rows from the top and its columns from the left. On rings, ring 0 is innermost,
sector 0 is at the top, and sectors count clockwise. Which way pieces fall or float is a rule, never a
way of counting.

A grid may have a **rim**: a ring of cells just outside its playing area, for ports, feeders, hatches and
turrets. Rim cells are cells like any other.

> Racks is a grid of five columns whose pieces fall to the bottom of each column. Deflectors' 24
> ports are the rim of its 6 by 6 grid.

### Terrain and maps

Each cell has one **terrain**: what the cell is, as opposed to the piece on it, such as a wall, a block,
a port or a current. Terrain is plain unless the puzzle says otherwise, and it may have states, as a
mirror that flips does. A cell holds at most one piece.

A puzzle either deals its terrain, as it deals pieces, or draws it by hand as **maps**. A puzzle with
maps has a setting holding a list of them, and the seed picks one for each round.

> Deflectors deals its mirrors, and Tug its blocks. Gunnery's decks and Space Battle's fields are maps.

### One board, or one each

A puzzle played between sides has either one board all sides share, or one board for each seat, all of
the same shape.

> Space Battle's two ships share one board. In Swordfighting every player has a board of their own and
> sees everyone else's.

### Zones

A **zone** is a named place beside the board that holds a fixed number of pieces. A player either only
watches a zone or takes pieces from it.

> The next pair in Engines is a watched zone of one. Plating's tray is a zone of three that each move
> takes a plate from.

### Places

A **place** is a cell on a board or a numbered spot in a zone. Moves and events point at places.

## Pieces

A **piece** is anything on the board the rules know about: something a player can join, move, clear
or has to work around. The rules know each piece by its id, a number unique within the round from the
moment it is dealt until it leaves. How it looks and what it is called belong
to the skin.

Most pieces sit in one cell. A piece's **footprint** may cover several cells together, as a plate of
five cells or a rectangle cut from a slab does.

Three more ideas describe a puzzle's pieces.

- **Families and kinds.** Many puzzles deal pieces that are alike except for which one they are, such
  as the debris in Paths: a path joins pieces of one kind, and any kind works the same way. Those
  pieces are one **family**, and each member is a **kind**. The puzzle does not list its kinds one by
  one. A setting says how many are dealt, and the kinds are numbered from 1. The skin needs a drawing
  for every kind that setting allows.
- **States.** A piece can change while it is on the board. Its **state** is either one of a few named
  forms, such as a rod that is cold or hot, or a number it shows, such as the moves a fuse has left.
  Each named state has a drawing of its own. A number is drawn by repeating one mark on the piece,
  such as one notch for each move left.
- **Pieces based on others.** A piece can be an ordinary piece with something added. It behaves as
  the piece it is based on, and has rules and states of its own on top.

> Paths' pieces:
>
> | Piece | On the board | How the puzzle declares it | In the space theme |
> |---|---|---|---|
> | `kind` | What a path is drawn through. A path joins touching pieces of one kind | A family. The `kinds` setting deals 2 to 8 kinds | Debris: an ingot, a panel, a shard, a crystal, a cell |
> | `prize` | A piece no path can join. It sinks as the pieces under it clear, and a closed path takes it | A plain piece | A loot crate |
> | `timed` | A kind with a fuse. It joins paths as its kind; if the fuse runs out, it ruins the pieces around it | Based on `kind`. Its state is a number: the moves its fuse has left | A volatile |
> | `ruined` | What a timed piece leaves around it when its fuse runs out. No path can join it | A plain piece | Rubble |

## The deal

The **deal** is everything luck puts in a round. The seed fixes it, and the puzzle declares it in
full, so a reader of the puzzle knows what is luck and what is skill without reading the rules.

### Draws

A **draw** is one source of luck. A puzzle declares each with:

| Field | Holds |
|---|---|
| id | A neutral word |
| line | One plain sentence on what it decides |
| gives | What it decides: a kind, a piece, a place, a map, a task, or a number |
| by | How: an even roll, a weighted roll, a bag, or a pick from a list |
| when | When it is drawn: at the start, on a refill, for a new task, on a tick, or every so many moves |
| reads | The settings that size it |

| By | Draws | Example |
|---|---|---|
| Even roll | Each item alike, every time | Paths' debris: any of the `kinds` |
| Weighted roll | Each item by its weight, or yes or no by a chance | Paths' prizes: `prizePermille` |
| Bag | A shuffled set dealt out in order, then shuffled again | Gunnery's feed: every seven pieces hold the same seven |
| Pick | One entry of a list setting | Gunnery's deck, one of its maps |

A draw belongs to a layer when only that layer's rules call for it.

### Streams

Every draw has a **stream** of its own, made from the seed and the draw's id. Nothing a draw gives
depends on another draw, so a move that changes what one draw is asked for never changes what the
others give. Two rounds on one seed meet the same luck for as long as they ask for it alike.

A puzzle played between sides says, for each draw, whether every seat reads one shared stream or each
has its own. On a shared stream every seat meets the same items in the same order, so nobody is dealt
luckier than another.

> Swordfighting's pairs are a shared stream: every board in a fight is dealt the same pairs, in the
> same order.

### Checks

A **check** is a test a deal must pass before a player sees it: a move can be made, or the task can be
solved from what is shown. A puzzle declares each check with the draws it covers, how many **tries**
the rules make, and a **fallback** for when every try fails. A fallback always passes, so no round is
ever dealt one that fails. A deal that would force a guess fails its check.

A check can also hold during play. When the board has no move left, the rules deal it again, and an
event says so.

> Paths checks that a path can be drawn, at the start and after every refill, in up to 50 tries. Its
> fallback lays a path of `pathMin` pieces of one kind. When no path is left during play, the board is
> dealt again and `reshuffle` says so.

### Bounds

A **bound** is a setting that caps what one draw can give, so no round is made by one windfall. A
puzzle names the draw each bound caps.

> Cutting's `maxBlockPercent` keeps any block to 45 percent of its slab.

### Secrets

A **secret** is part of the deal a player does not see: where Scanner's contacts lie, or a side's
orders before a turn resolves. A puzzle declares each secret with the draw or the moves it hides and
the events that reveal it. A secret only ever comes out on an event. Until then it says who may see
it: nobody, the seat it belongs to, or that seat's side.

A round with a secret is run by its host, who keeps the seed and plays every entry. A player's board
gets the round without the secret and plays from events, so a move that can reveal something waits on
the host. Nothing a player is shown is ever false.

## Depth

### Layers

A **layer** is a named group of rules that is either on or off. It brings the pieces, events,
settings, zones, gauges, controls, payouts, multipliers, tasks and draws that exist only while it is on. What a layer's rules cause elsewhere, such as a par rising
because there is more to plan around, is not the layer's concern.

### The ladder

A **ladder** is a puzzle's stages in order. It has two to four stages; each layer is added by exactly
one stage; no stage switches a layer off; and the last stage, `full`, is the whole puzzle.

A **stage** is its layers and one **threshold**: the bar a player clears to move to the next stage. A
stage changes nothing but which layers are on. Its round length, settings and tier starts are the whole
puzzle's. The threshold's measure is one of:

| Measure | Counted in |
|---|---|
| Best round at this stage | Points |
| Average of the last few rounds at this stage | Points |
| Wins over a stand-in at this stage | Wins |
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
begin. So does a puzzle between sides that is judged by its score ([Versus](#versus)). A round's
**performance** is its score placed on the shared scale through those tier starts, in straight lines
between them. No host or role can move a puzzle's tier starts.

> Paths' tier starts: Steady 850, Sharp 2450, Masterful 4800, Legendary 8400.

**Pace** is performance over the recent stretch of a round, read while it is played. The puzzle
declares its **pace window**, the length of that stretch: about two of its scoring events.

### Standing

A player's **standing** at a puzzle is their level across rounds, built from their performances and
shown as a tier. The host keeps it. Solo and versus rounds build it on the same scale.

### Versus

A puzzle played between sides declares how its rounds are judged: by their outcome, or by their score.

Judged by its outcome, a round is weighted by the opponent's standing: beating a stronger opponent
earns more. Its performance is the opponent's standing, one tier up for a win or one down for a loss.

> Beating a Sharp opponent is a Masterful round. Losing to a Steady stand-in is a Green one.

Judged by its score, a round is placed through the puzzle's tier starts as a solo round is, whoever
the opponent was.

## Versions

A log only replays the same on the rules it was played on, so a puzzle carries a **version**, written
`major.minor`: one for its rules and its document together. Every puzzle starts at `0.1`, a prototype
too, and a puzzle promoted into a world keeps its version running.

### What raises it

| Part | Rises when | Then |
|---|---|---|
| **Major** | A change can make a stored round replay differently from the same seed, settings and log: the rules, the deal, the board, pieces, moves, events, tempo, endings or the log cap | The minor goes back to 0 |
| **Minor** | Any other number in the puzzle changes: a setting's default or bounds, a relation, tier starts, the ladder, the pace window | |

Wording raises nothing: a setting's line or the mechanic. Skins raise nothing either, since a drawing,
cue, text or motion changes no round. A skin has no version of its own; it must be ready against the
puzzle's current version, and that is checked whenever the version rises.

The version rises once for each change that merges, never at each save of a draft. The puzzle's
**history** keeps one plain line for each version, and a host may show the newest line when a player
first meets a new version.

> Say Paths is at `2.3` and retunes `loopPercent`'s default: `2.4`, "loops pay 10% more". It then deals its
> prizes on a stream of their own, which changes what a seed deals: `3.0`.

### Stored rounds

A **stored round** is what a host keeps of a judged round: the puzzle and its version, the seed, every
setting's value (not only those changed from a default) and the layers on, the log, and the score,
performance and tier it judged. Because every value is kept, a later change to a default never changes
what an old round was.

A judged round is final. It is never judged again, even when a later version would score its log
differently, and the standing and ladder places built from it stand.

### When a version changes

- **Rounds in flight** are played and judged on the version they were dealt on. Every new round is
  dealt on the current version, so the sides of a versus round always share one, and a ghost is drawn
  only from rounds of the same version.
- **Replay** is promised for the current and previous major. The host keeps the previous major's rules
  until every round dealt on it could have ended, as the log cap and the clock bound, then refuses logs
  for it. A round from an older major still shows its score and tier, but cannot be watched again. A
  host may keep more.
- **Standing** carries over unchanged: tier starts already put every version on the one scale. The host
  may widen how unsure it is of a standing after a change, and never resets it.
- **Ladder places** are kept by stage id. A player whose stage is gone moves to the next stage that
  still exists, never back. Rounds already played at a stage count toward its threshold.

### Witness rounds

Each puzzle keeps a few **witness rounds**: recorded rounds, each a seed, settings, log and the read
it must give. A change that alters any of them without raising the major fails the checks, so the rule
above does not rest on anyone noticing. Raising the major records them again.

## Sides

A puzzle played between sides declares how many **sides** a round has and how many **seats** each holds,
as a least and a most. An **opponent** is whoever holds a seat on another side. A **stand-in** is an
opponent the rules play themselves, in a seat no player holds.

Every move is made by a seat. A solo puzzle has one side of one seat, and declares neither.

Opponents, and everything they do to each other, are inside the puzzle. An attack from one board to
another is part of the rules, not a signal.

### Stand-ins

Stand-ins come in four **types**, the same for every puzzle:

| Type | Plays |
|---|---|
| Careless | Any move the rules allow, at random |
| Greedy | The move worth the most now |
| Planner | The move whose best few moves after it are worth the most |
| Ghost | A player's own round, replayed from its log on the same deal and version |

Each takes two **dials**: its **delay**, the time it takes over a move, and its **slip**, the share of
its moves made at random instead. A stand-in is a type and its dials. A host or a role picks the
stand-in for a seat.

A puzzle between sides takes every type when its rules can list the moves a round allows and say what
each is worth now. A ghost also needs boards the other side cannot touch, since a replayed move must
still be one the rules allow; a puzzle says whether it takes ghosts. A puzzle may add stand-ins of
its own, beside the four.

The four types choose from everything on the board, so they play only where a seat sees all of it. A
puzzle with a secret a seat cannot see, such as another seat's cards, brings stand-ins of its own.

A stand-in plays through the same rules as a player: its move must be one the rules allow, and it does
what a player's would. Its moves are never entries in the log. A replay works them out again, and the
board sets the pace they are shown at ([The rules](#the-rules)).

A stand-in's standing is measured, never set by hand: the host starts it where it lands against the
other stand-ins and moves it with its results against players, as it moves a player's.

> A raider tier aboard a ship is a stand-in: a junker is greedy with a long delay and a large slip; the
> fiercest is a planner with a short delay and none.

## What a player sees

A player sees everything the rules know about the board, except a declared secret
([Secrets](#secrets)). What the deal brings next may still be luck.

A puzzle may offer **teaching**, and declares whether it does:

- A **preview** tells what a move would do before it is made.
- A **hint** offers a move worth making to a player who is stuck. A round that counts never hints.

Both are questions asked of the rules, so neither changes a round ([Hooks](#hooks)).

## The rules

The **rules** are a puzzle's code, and the only part of it that is code. They are written as **hooks**
on the **loop** every round runs (ADR 0088). The loop is the same for every puzzle, and it keeps
everything this guide gives one meaning: the log, time, seats, tasks, points, the streak, the endings
and what each seat may see. The rules hold only what is the puzzle's own.

### The loop

| Stage | What happens | Hooks asked |
|---|---|---|
| Start | The round is made from its seed and settings | `onStart` |
| Wait | The round waits for an entry or a tick. A seat no player holds does not wait: it is played | `whoseTurn`, `pickMove` |
| Check | A move the rules do not allow changes nothing, and its reason goes back to the board | `canMove` |
| Move | The move is made. In a puzzle of turns, every seat's move for the turn is made together | `onMove` |
| Cascade | What the move sets off, a step at a time, until a step reports nothing. The loop counts the steps | `onCascade` |
| Move end | Asked once, when the cascade has run dry. What it reports may set the cascade off again, on the same count | `onMoveEnd` |
| Close | Points are paid, the streak is kept, tasks are graded and dealt, and the endings are checked | `pointsFor`, `onTaskNeeded` |
| End | An ending is met, and the score and the outcome are read | `score` |

`start` runs Start. `play` runs Check to Close for one entry, after every tick that falls due before
it, and Wait to Close runs again until an ending is met. A tick goes to `onTick` and a signal in to
`onSignal`, where a move goes to `canMove` and `onMove`.

### Hooks

A **hook** is a named place in the loop where the rules are asked. Its name says which of two kinds it
is. A hook that starts with `on` is asked when something has happened, and it changes the round in one
way only: it reports events, and reads the board as each event leaves it. Every other hook is a
**question**: the rules answer it, and answering changes nothing.

| Hook | Asked | When the rules leave it out |
|---|---|---|
| `onStart` | Once, at Start: deal the board | Required |
| `canMove` | May this seat make this move now, and if not, why | Required |
| `onMove` | What a move that passed the check does | Required |
| `onCascade` | Again and again after a move, until it reports nothing: one step of what follows by itself | Nothing follows |
| `onMoveEnd` | Once a move, when the cascade has run dry: what the end of the move brings | Nothing |
| `onTick` | Once for every tick, in order | Nothing happens between moves |
| `onSignal` | A signal in arrives | It changes nothing |
| `onTaskNeeded` | Fewer tasks are open than the puzzle declares: deal one, or say there is no room yet | The puzzle has no tasks |
| `whoseTurn` | Which seat no player holds moves next | Only players move |
| `pickMove` | What that seat plays | One of the four stand-in types plays, where the rules answer `listMoves` |
| `listMoves` | Which moves a seat can make now | None of the four types plays, and nothing can tell that a seat has no move left |
| `pointsFor` | What an event is worth | The puzzle's payouts and multipliers pay |
| `score` | The round's score, read from every side's points, the time played and the outcome | The points of the player's side |
| `hint` | A move worth making | The puzzle offers no hint |
| `checkSettings` | Before a round starts: what is wrong with these settings or this map | Only bounds and relations are held |

A puzzle may add questions of its own for whatever else a board, a stand-in or a hint needs to ask,
such as a preview. A question can be asked at any time, and the round is the same afterwards.

A hook added to this list later comes with a default, so no puzzle already written has to change.

### What the loop keeps

- **Seats.** Every seat runs the same loop. A seat a player holds waits for that player's move. For a
  seat no player holds, `whoseTurn` and `pickMove` are asked and the answer is played at once, through
  the same `canMove` and `onMove`.
- **Turns.** In a puzzle of turns each seat's move is held back until every seat has one, and `onMove`
  is asked once with all of them. `canMove` is asked a seat at a time, and a stand-in plans before it
  can see a player's plan.
- **Ticks.** Within one tick the order is fixed: `onTick`, then each seat no player holds whose time
  to move has come, lowest seat first, then a player's move stamped at that tick. How often such a
  seat moves is its delay, which the loop keeps.
- **Tasks.** The loop keeps which tasks are open, grades each one, pays on the grade and meets the
  stock ending. The rules deal a task in `onTaskNeeded` and say on an event when one is done, wherever
  that happens, a cascade included.
- **What a seat sees.** A question about a move, which is `canMove`, `listMoves`, `pickMove`, `hint`
  or one of the puzzle's own, is asked with only what its seat may see ([Secrets](#secrets)). The
  hooks that start with `on`, `pointsFor` and `score` see the whole round.
- **A board with no move left** has no hook of its own. The rules report it from `onMoveEnd`: the
  round fails, the task ends, or the seat is out.

## Motion

**Motion** is how what happens on the board plays out on a screen. The puzzle says what changes, the
skin says how it plays, and the host holds where motion meets play (ADR 0073). Motion never reaches the
rules, so no skin can change a round.

### Board changes

Everything that happens on the board is one of four **board changes**:

| Change | What happens | It says |
|---|---|---|
| Arrive | A piece comes onto the board | The piece, the place it lands, and where it comes from: in place, a spot in a zone, or off the board in a direction |
| Leave | A piece goes from the board | The piece, and whether it is cleared or taken to a spot in a zone |
| Travel | A piece goes from one cell to another | The piece, where it starts and ends, and its route when it passes through other cells |
| Change | A piece's state or kind, or a cell's terrain, becomes another where it stands | The piece or the cell, and what it becomes |

Every board change is carried on an event, and a puzzle declares which changes each event can carry. A
board drawn from a round's start and its events alone matches the round, and a test checks that it
does. A board plays from events, never by comparing one state with the next.

> Paths: `clear` and `loop` carry the leaves of the pieces they take. `refill` carries the travels of
> pieces falling and the arrivals of new ones from above the board. `blowup` carries the changes of a
> timed piece and its neighbours to `ruined`.

### Playing it out

One entry's events play in the order the rules report them. Everything in one cascade step plays
together, and the next step starts once it is done. How long each takes is the skin's: no length of
motion is a setting or written in the puzzle.

A board **settles** when everything an entry set off has finished playing. Until then it takes no touch:
a touch is dropped, and a gesture already under way, such as a path being drawn, waits to finish.
Motion from ticks never holds a board, and the host plays ticks as they fall due, so their events reach
the board as they happen.

The clock and the ticks keep running while a board settles. The host's **ceiling** caps what that can
cost: whatever one entry sets off plays for at most about a second, and past it the host snaps it to
its end. Settling is the board's rule alone. The rules and the server never depend on it, and accept
any entry with a good time.

### The moment and the beat

A puzzle names its **moment**: the one event that is its biggest, an optional condition on it, and the
number field that says how big each one is, with the value that counts as biggest. Which moment is
biggest follows from scoring, so every skin of a puzzle agrees on it.

The skin plays the **beat** on the moment: one pulse over the whole board, on top of every other
motion. A bigger moment is a stronger pulse, never a second effect. The beat has one cue of its own,
heard alone, with no other cue over it.

> Paths' moment is `loop` when `prizes` is above 0, sized by `prizes` out of `maxPrizes`. A long path
> gets a callout, but no beat.

### The skin's motion

A skin's **motion** says how everything plays:

- each board change's length and easing, and how a piece leaves, shrinking or fading;
- the **stagger** between the places of one event, such as a path played in the order it was drawn;
- for each event, its **marks**, rings at places or lines through places, drawn from the event's own
  place fields to show a rule at work, and the place its points rise from;
- a rank for callouts: an entry shows at most one, the highest it earned;
- the beat's pulse;
- what it does for **reduced motion**, which the host passes on from the player.

Motion the player makes, and motion while nothing happens, such as a path being drawn, a piece in hand,
a fuse that flickers or a gauge rolling up, is the skin's too. It is read from the round's state and
never holds a board.

A new skin's motion starts as a copy of its theme's, as its cues do. The space theme's motion is in `docs/BRAND.md` section 6: a travel of 120ms, a clear of 160ms, ease-out, and a pulse of
420ms in `amber`.

## The skin

A **skin** dresses one puzzle with looks and sound, and never sets a number: not even how many kinds a
board deals.

- **Theme.** The skin names its one theme, and every colour it uses is one of that theme's.
- **Drawings.** Every piece has a **drawing**, made of shapes on a 24-unit square. A piece with named
  states has one for each; a count is drawn by repeating one layer of the drawing. A family needs a
  drawing for every kind its setting allows.
- **Cues.** The skin holds its own copy of every **cue** it plays, each a short synthesized sound in the
  scale of its theme's sound frame. A new skin starts from a copy of its theme's cues.
- **Events.** For each event, the skin names the cues it plays, which may be none, its marks, where its
  points rise from, and its callout's rank. It also voices the host's start, countdown and end.
- **Motion.** How each board change plays, the stagger, the beat's pulse on the puzzle's moment, and
  what reduced motion does ([Motion](#motion)).
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
| `gauge.<id>` | Each gauge's label |
| `control.<id>` | Each control's label |

## Themes

A **theme** dresses every puzzle in one look, such as space (ADR 0077). It is a document of its own,
beside the puzzle and the skin, and holds what its skins share:

- **Palette.** Every colour, a name and a value. Every theme fills the seven **fixed colours**:
  `ground`, `raised`, `line`, `text`, `dim`, `yours` (what is the player's, or active) and `danger` (what
  is bad), so a host and any skin work under any theme. Its **piece colours** are a list it names
  freely, at least eight, because a family can deal eight kinds.
- **Type.** Its typefaces and their sizes.
- **Sound frame.** The scale every cue's notes come from, and its limits: the longest cue and the
  highest cutoff.
- **Starting cues and motion.** What a new skin copies.
- **Host texts.** The words the host says in this theme: a name for each tier, and its start, countdown
  and end.

Arrangement, the chrome's shapes and a host's world stay the host's.

### Read, and copied

A skin reads its theme's palette and type: it names a colour, and the theme says what it is, so
recolouring a theme recolours every board in it. A skin copies its theme's cues and motion when it is
made, so each puzzle can revoice its own without a change heard on other boards.

Changing a theme's starting cues or motion changes no skin by itself. Whoever changes it can carry the
change to every skin of the theme in one step, or to one skin at a time, and is shown which skins had
changed their own copy before those are overwritten.

### What every theme keeps

What access and the painter need holds in every theme: each kind is told from every other by its
silhouette alone, colour is never the only signal, and a drawing is made on the 24-unit square. Taste
is each theme's: its sound frame is data the checks read, and the rest is prose in its own brand book.

### Skins, hosts and new themes

A skin names its one theme. A host runs one theme at a time and picks it; the player does not. A
puzzle's default skin is its skin in the default theme.

A new theme starts as a copy of another, skins and all, so every board plays from the first minute.
Its skins may then redraw any piece as a different subject, within what every theme keeps. A theme has
one palette: a light look is a theme of its own.

The studio edits a theme, its palette, type, sound frame, starting cues and motion, and host texts, in
a draft, as it edits a skin.

> Space is the first theme, and the default. Its document is made from the brand book (`docs/BRAND.md`):
> `cream` fills `text`, `amber` fills `yours`, and its eight piece colours run from `sand` to `slate`.
> Its type is Atkinson Hyperlegible, its sound frame is G major pentatonic from G2 to G5 with no cue over
> 400ms and no cutoff over 2.4kHz, and its starting cues are those in `boards/data/cues.json`.

## The documents

Each puzzle is two documents: the **puzzle** and its default **skin**. Every skin belongs to a
**theme**, the third document. A host reads all three when it runs a round. The rules are the only part of a puzzle that is code, written as hooks ([The rules](#the-rules)).

### The puzzle

```json
{
  "id": "a neutral word for the mechanic",
  "version": "major.minor",
  "history": [{ "version": "major.minor", "line": "what changed, in one plain line" }],
  "mechanic": "one line, plain English",
  "verb": "the id of the move the puzzle is built around",
  "round": {
    "tempo": { "kind": "still | ticking | turns", "tickMs": "ticking only", "turnSeconds": "turns only" },
    "ends": [{ "by": "clock | budget | stock | fail | outcome", "setting": "what sizes it", "event": "what names it" }],
    "logLimit": "the fixed cap on the log"
  },
  "opponents": "absent when solo, or { sides, seatsPerSide: [least, most], ghosts: true or false, standIns: [{ id, line }]: its own, beside the four }",
  "board": { "shape": "grid | rings", "width": "grid", "height": "grid", "touch": "grid: 4 | 8", "rim": "grid: true or false",
             "rings": "rings", "sectors": "rings", "shared": "between sides: true, or one board a seat" },
  "terrain": [{ "id": "", "states": "names, if it has any" }],
  "zones": [{ "id": "", "holds": "how many pieces", "player": "watches | takes" }],
  "settings": [{ "id": "", "type": "whole | percent | permille | list | flag | maps", "default": "", "min": "", "max": "", "line": "", "group": "board | deal | tempo | scoring",
                 "unit": "seconds | ticks | moves | cells | pieces | points", "entries": "list: { least, most } or { count }, and { min, max } each",
                 "map": "maps: { board, check }", "role": "true when a role may set it" }],
  "relations": [{ "is": "at-most | below | ascending | fits", "a": "a setting", "b": "a setting, or the board" }],
  "deal": {
    "draws": [{ "id": "", "line": "", "gives": "kind | piece | place | map | task | number", "by": "even | weighted | bag | pick",
                "when": "start | refill | task | tick | every: a setting", "reads": ["setting ids"], "shared": "between sides: true, or a stream a seat" }],
    "checks": [{ "id": "", "line": "", "draws": ["draw ids"], "tries": "a number", "fallback": "one line: what is dealt, and why it passes", "during": "the event that says the board was dealt again, if it holds during play" }],
    "bounds": [{ "setting": "", "caps": "a draw id" }],
    "secrets": [{ "id": "", "line": "", "hides": "a draw id, or turn orders", "seenBy": "nobody | seat | side", "revealedBy": ["event ids"] }]
  },
  "layers": [{ "id": "", "rule": "one line", "brings": { "pieces": [], "events": [], "settings": [], "zones": [], "gauges": [], "controls": [],
             "payouts": [], "multipliers": [], "tasks": [], "draws": [] } }],
  "ladder": [{ "stage": "", "adds": ["layer ids"], "advance": { "measure": "best-round | average-of-last | wins-over-stand-in | rounds-played", "threshold": "in the measure's unit" } }],
  "evaluation": { "tierStarts": "judged by score: { steady, sharp, masterful, legendary }", "by": "between sides: outcome | score", "paceWindowSeconds": "" },
  "signals": { "in": [{ "id": "", "type": "number | flag | outcome", "when": "on-change | sampled | at-end" }], "out": [] },
  "pieces": [{ "id": "", "footprint": "one cell, or the cells it covers", "family": "the setting that counts its kinds", "of": "the piece it is based on", "states": "names, or { count }" }],
  "moves": [{ "id": "", "line": "", "gesture": "tap | long-press | draw | drag | swipe | slice | turn | hold", "inHand": "true when built in hand",
              "fields": { "<name>": "place | places | direction | piece | number | flag" } }],
  "controls": [{ "id": "", "move": "the move it makes, or none for a switch", "key": "its letter" }],
  "events": [{ "id": "", "line": "", "fields": { "<name>": "place | places | piece | player | number | points" }, "mistake": "true when it is one",
              "changes": ["arrive | leave | travel | change: the board changes it can carry"] }],
  "moment": { "event": "the event id", "when": "an optional condition on it", "size": "its number field", "most": "a number or a setting: the biggest" },
  "payouts": [{ "id": "", "line": "", "on": ["event ids"], "counts": "the event's field it grows from", "growth": "flat | linear | superlinear | stepped",
                "cap": "a number or a setting", "reads": ["setting ids"] }],
  "multipliers": [{ "id": "", "line": "", "scales": ["payout ids"], "on": "the event, and the condition, it applies on",
                    "by": "{ percent: setting }, or { table: list setting, index: streak | step }" }],
  "streak": "absent, or { builds: { event, when } or { grade }, grace, breaksOn: [mistake event ids] }",
  "tasks": [{ "id": "", "line": "", "open": "how many at once", "ends": ["done | given-up | out-of-time"], "control": "given-up only", "setting": "out-of-time only",
              "graded": "par | best | none", "grades": ["from best"], "next": "dealt, or the control that asks for it" }],
  "gauges": [{ "id": "", "line": "", "most": "a number or a setting", "danger": "the value past which it means danger" }],
  "stats": [{ "id": "", "line": "" }],
  "texts": [{ "key": "", "placeholders": [] }],
  "teaching": { "preview": "true or false", "hint": "true or false" }
}
```

A board's sizes, a zone's capacity and a gauge's most are each a number, or the setting that holds it.

### The skin

```json
{
  "puzzle": "the puzzle's id",
  "theme": "the theme's id",
  "pieces": { "<piece id, or family_kind>": "a drawing, or one per named state, or a drawing with a count layer" },
  "cues": { "<name>": "a whole cue" },
  "motion": {
    "changes": { "<arrive | leave | travel | change>": { "ms": "", "ease": "linear | in | out | in-out", "as": "leave only: shrink | fade" } },
    "stagger": "ms between the places of one event",
    "beat": { "ms": "", "color": "one of the theme's colours", "strength": { "from": "", "to": "" } },
    "reduced": { "changes": "cut | as-is", "beat": "still | as-is" }
  },
  "events": { "<event id, or start | countdown | end>": { "cues": ["cue names"], "marks": [{ "ring | line": "a place or places field" }],
              "points": "the place field they rise from", "callout": "its rank, 1 the highest" } },
  "texts": { "<key>": "the text, keeping the key's placeholders" }
}
```

### The theme

```json
{
  "id": "the theme's id",
  "palette": {
    "fixed": { "ground": "", "raised": "", "line": "", "text": "", "dim": "", "yours": "", "danger": "" },
    "pieces": { "<name>": "a value: eight or more" },
    "names": { "<fixed colour>": "the theme's own name for it, if it has one" }
  },
  "type": { "faces": { "text": "", "numbers": "" }, "sizes": { "<step>": { "px": "", "weight": "regular | bold" } } },
  "sound": { "scale": ["the notes every cue's notes come from"], "longestMs": "", "cutoff": "the highest, in Hz" },
  "cues": { "<name>": "a whole cue: what a new skin copies" },
  "motion": "a whole motion, as a skin's: what a new skin copies",
  "texts": { "tier.<id> | start | countdown | end": "the text" }
}
```

### A puzzle is ready when

- Every part of the puzzle is filled in.
- The ladder has two to four stages, each layer is added by exactly one, and the last is `full`.
- The rules know every layer, setting, relation, terrain, zone, piece, state, move, control, event,
  gauge, payout, multiplier, task, draw, check, secret and signal the puzzle declares, and declare nothing it lacks. A host checks this before it runs a round.
- The moment names one of the puzzle's events and a number field of it.
- Every draw has a stream of its own, every check has a fallback that passes, and every secret is
  revealed by an event.
- The rules answer `onStart`, `canMove` and `onMove`.
- A puzzle between sides can list the moves a round allows and say what each is worth, so it takes
  every type of stand-in, or it brings a stand-in of its own.
- The puzzle keeps witness rounds, each still giving the read recorded for it, and a history line for
  its current version.
- The skin has a drawing for every piece, state and kind, a cue for every cue an event names, a text
  for every key with its placeholders kept, a beat cue, and a motion for every board change.

A theme is ready when every fixed colour is filled, it has at least eight piece colours, every skin's
colours name its palette, every starting cue's notes are in its scale and within its limits, its type
names its faces and sizes, it has a text for every host key, and it has a skin for every puzzle the
host deals. A host checks this before it uses a theme.

A puzzle that is not ready can still be edited and dressed. A puzzle with no rules yet cannot be
played.

### Example

Paths, which the space theme calls Salvage, is written out in full in two files:
[the puzzle](./examples/paths.puzzle.json) and [its skin in the space theme](./examples/paths.skin.json).
An excerpt of the puzzle:

```json
{
  "id": "paths",
  "version": "0.1",
  "mechanic": "Draw a path through touching pieces of one kind to clear them",
  "verb": "trace",
  "round": { "tempo": { "kind": "still" }, "ends": [{ "by": "clock", "setting": "roundSeconds" }], "logLimit": 600 },
  "board": { "shape": "grid", "width": "width", "height": "height", "touch": 8, "rim": false },
  "layers": [
    { "id": "loops", "rule": "a closed path takes every prize at once",
      "brings": { "events": ["loop"], "settings": ["loopMin", "loopPercent", "insidePoints", "prizeLoopPoints"] } }
  ],
  "moves": [{ "id": "trace", "line": "draw a path through touching pieces, closed or open", "gesture": "draw",
              "fields": { "path": "places", "closed": "flag" } }],
  "events": [{ "id": "loop", "line": "a closed path took every prize", "fields": { "path": "places", "inside": "places", "prizes": "number", "points": "points" },
               "changes": ["leave"] }],
  "moment": { "event": "loop", "when": "prizes > 0", "size": "prizes", "most": "maxPrizes" },
  "gauges": [{ "id": "prizes", "line": "prizes on the board", "most": "maxPrizes" }],
  "evaluation": { "tierStarts": { "steady": 850, "sharp": 2450, "masterful": 4800, "legendary": 8400 }, "paceWindowSeconds": 10 }
}
```

## Not yet covered

- **Versus details:** a drawn round, how each seat is judged when a side holds several, and what a turn
  does when its time runs out with no orders.
