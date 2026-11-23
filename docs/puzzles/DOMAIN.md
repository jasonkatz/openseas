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
| **Puzzle** | Rules, round, board, pieces, layers and ladder, evaluation, settings, moves, events and the board changes they carry, its moment, gauges, stats, signals, text keys | Name a world thing, draw, sound, hold a text's content, or decide where anything sits on a screen |
| **Skin** | The drawings, cues, texts and motion that dress one puzzle | Set or change a number, or change a round |
| **Host** | Runs rounds, replays logs, keeps each player's standing and place on a ladder, owns the tier scale, holds the ceiling on motion | Change a puzzle's rules or tier starts |
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
its typed fields: place, places, piece, player, number or points, and the board changes it can carry
([Motion](#motion)). Every number a player sees counted on the board arrives on an event, so nothing
outside the rules works out a score, and every change to the board arrives on one too.

> Paths' `loop`: "a closed path took every prize", carrying the path's places, the places inside it,
> the number of prizes and its points.

A round's start, its countdown and its end are the host's, the same for every puzzle. A puzzle
declares only its own events.

### Points and score

**Points** are what one event adds, each point belonging to a payout ([Scoring](#scoring)). The
**score** is the sum of a round's points, and it never goes below zero.

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

A round played between sides keeps a score, for the player to watch and for the result, but its
performance comes only from its outcome ([Versus](#versus)). No score is scaled by the opponent.

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

## Depth

### Layers

A **layer** is a named group of rules that is either on or off. It brings the pieces, events,
settings, zones, gauges, controls, payouts, multipliers and tasks that exist only while it is on. What a layer's rules cause elsewhere, such as a par rising
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

A new skin's motion starts as a copy of the game's, as its cues do. The game's motion is the space
theme's, in `docs/BRAND.md` section 6: a travel of 120ms, a clear of 160ms, ease-out, and a pulse of
420ms in `amber`.

## The skin

A **skin** dresses one puzzle with looks and sound, and never sets a number: not even how many kinds a
board deals.

- **Drawings.** Every piece has a **drawing**, made of shapes on a 24-unit square. A piece with named
  states has one for each; a count is drawn by repeating one layer of the drawing. A family needs a
  drawing for every kind its setting allows.
- **Cues.** The skin holds its own copy of every **cue** it plays, each a short synthesized sound in the
  one scale of the brand book. A new skin starts from a copy of the game's cues.
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
  "board": { "shape": "grid | rings", "width": "grid", "height": "grid", "touch": "grid: 4 | 8", "rim": "grid: true or false",
             "rings": "rings", "sectors": "rings", "shared": "between sides: true, or one board a seat" },
  "terrain": [{ "id": "", "states": "names, if it has any" }],
  "zones": [{ "id": "", "holds": "how many pieces", "player": "watches | takes" }],
  "settings": [{ "id": "", "type": "whole | percent | permille | list | flag | maps", "default": "", "min": "", "max": "", "line": "", "group": "board | deal | tempo | scoring" }],
  "layers": [{ "id": "", "rule": "one line", "brings": { "pieces": [], "events": [], "settings": [], "zones": [], "gauges": [], "controls": [],
             "payouts": [], "multipliers": [], "tasks": [] } }],
  "ladder": [{ "stage": "", "adds": ["layer ids"], "advance": { "measure": "best-round | average-of-last | wins-over-stand-in | rounds-played", "threshold": "in the measure's unit" } }],
  "evaluation": { "tierStarts": "solo: { steady, sharp, masterful, legendary }", "by": "versus: outcome", "paceWindowSeconds": "" },
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
              "graded": "par | best | none", "grades": ["from best"] }],
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
  "pieces": { "<piece id, or family_kind>": "a drawing, or one per named state, or a drawing with a count layer" },
  "cues": { "<name>": "a whole cue" },
  "motion": {
    "changes": { "<arrive | leave | travel | change>": { "ms": "", "ease": "linear | in | out | in-out", "as": "leave only: shrink | fade" } },
    "stagger": "ms between the places of one event",
    "beat": { "ms": "", "color": "a palette token", "strength": { "from": "", "to": "" } },
    "reduced": { "changes": "cut | as-is", "beat": "still | as-is" }
  },
  "events": { "<event id, or start | countdown | end>": { "cues": ["cue names"], "marks": [{ "ring | line": "a place or places field" }],
              "points": "the place field they rise from", "callout": "its rank, 1 the highest" } },
  "texts": { "<key>": "the text, keeping the key's placeholders" }
}
```

### A puzzle is ready when

- Every part of the puzzle is filled in.
- The ladder has two to four stages, each layer is added by exactly one, and the last is `full`.
- The rules know every layer, setting, terrain, zone, piece, state, move, control, event, gauge,
  payout, multiplier, task and signal the puzzle declares, and declare nothing it lacks. A host checks this before it runs a round.
- The moment names one of the puzzle's events and a number field of it.
- The skin has a drawing for every piece, state and kind, a cue for every cue an event names, a text
  for every key with its placeholders kept, a beat cue, and a motion for every board change.

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

- **Themes:** what a theme holds beyond its skins. For now a theme is a set of skins, and a new skin
  copies the game's cues and motion.
