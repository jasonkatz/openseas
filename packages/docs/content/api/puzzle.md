The puzzle document is one JSON file, `<id>.puzzle.json`. It declares everything about a puzzle except what a move does, which is the [rules](/api/rules). Every key below is filled in before a puzzle is [ready](#when-a-puzzle-is-ready). An empty list is written as `[]`.

The examples are from Paths, a puzzle where a player draws a path through touching pieces of one kind. Where Paths has no use for a key, the example is from a puzzle that does.

## Identity

Who the puzzle is, and which form of it this is.

| Key | Type | Holds |
|---|---|---|
| `id` | id | A neutral word for the mechanic, such as `paths` or `swap`. It names the puzzle everywhere |
| `version` | string | `major.minor`. Every puzzle starts at `0.1`. See [Versions](/domain/versions) for what raises each part |
| `history` | list | One entry for each version, newest last |
| `history[].version` | string | The version the line is for |
| `history[].line` | line | What changed, in one plain line |
| `mechanic` | line | The whole puzzle in one line of plain English |
| `verb` | move id | The move the puzzle is built around: the act a new player learns first |

```json
{
  "id": "paths",
  "version": "0.1",
  "history": [{ "version": "0.1", "line": "First version" }],
  "mechanic": "Draw a path through touching pieces of one kind to clear them",
  "verb": "trace"
}
```

## The round

### `round`

How time moves, who may move, and what ends a round. The ideas are on [The round](/domain/round).

| Key | Type | Holds |
|---|---|---|
| `tempo.kind` | `"still"` or `"ticking"` | Still: nothing happens between moves. Ticking: the rules move on by themselves, one tick at a time |
| `tempo.tickMs` | number | Ticking only. The length of one tick. It is fixed by the puzzle and is never a setting |
| `acts` | `"anyone"`, `"in-turn"` or `"together"` | Who may move, for a round with no phases. Absent means anyone |
| `phases` | list | The named stretches of the round, as a tree, in the order they run. Absent for a round with none |
| `ends` | list | The round's endings. The first one met ends the round |
| `logLimit` | number | The fixed cap on the length of the log. It guards against a runaway round and is never a setting |

```json
{
  "round": {
    "tempo": { "kind": "still" },
    "ends": [{ "id": "time", "by": "clock", "setting": "roundSeconds" }],
    "logLimit": 600
  }
}
```

### `round.phases[]`

A phase is a stretch of the round shared by every seat: a hand, a leg, a turn. The engine opens and closes phases in the order declared. The rules never set one.

| Key | Type | Holds |
|---|---|---|
| `id` | id | A neutral word |
| `line` | line | What the phase is |
| `acts` | `"anyone"`, `"in-turn"`, `"together"` or `"nobody"` | How its seats act. Together: every seat owes one move, held back unseen and resolved as one. Nobody: the phase runs by itself |
| `moves` | list of move ids | The moves it takes. A move it does not list is refused before the rules are asked |
| `repeat` | number or setting | How many times it runs. Absent when once |
| `next` | control id | The control that starts the next repeat. Absent when the next repeat starts by itself |
| `tally` | boolean | True when it keeps a tally of the points paid while it is open |
| `phases` | list | The phases inside it, in order |

A phase closes on an event that names it in [`closes`](#events), when no seat is left to wait for, or when its repeats are used up.

```json
{
  "phases": [
    {
      "id": "hand", "line": "one deal, bid and played out",
      "repeat": "hands", "next": "deal", "tally": true,
      "phases": [
        { "id": "bids", "line": "each seat bids the tricks it means to take", "acts": "in-turn", "moves": ["bid"] },
        { "id": "tricks", "line": "thirteen tricks", "acts": "in-turn", "moves": ["play"] }
      ]
    }
  ]
}
```

### `round.ends[]`

| Key | Type | Holds |
|---|---|---|
| `id` | id | The ending's reason: what the host, the board and the score are told the round ended by |
| `by` | `"clock"`, `"budget"`, `"stock"`, `"fail"` or `"outcome"` | What kind of ending it is, from the table below |
| `setting` | setting | What sizes a clock, a budget or a stock |
| `event` | event id | What names a fail or an outcome |
| `phase` | phase id | A stock ending that counts a phase's repeats |

| `by` | Met when |
|---|---|
| `clock` | A length of time has passed |
| `budget` | A number of moves has been made. Between sides it counts turns for each seat, passed and lapsed turns included |
| `stock` | The round's fixed amount of deal has been worked through, or a phase has run its repeats |
| `fail` | The rules report a state the round cannot go on from |
| `outcome` | The round is decided between its sides |

No ending is required. One more ending is the host's and is never declared: `left`, met when the last player leaves.

## Sides and points

A solo puzzle leaves all three of these keys out. The ideas are on [Sides and seats](/domain/sides).

### `opponents`

| Key | Type | Holds |
|---|---|---|
| `sides` | `[least, most]` | How many sides a round has |
| `seatsPerSide` | `[least, most]` | How many seats each side holds |
| `ghosts` | boolean | Whether a seat can be played by a ghost: a player's own round replayed from its log. It needs boards the other side cannot touch |
| `standIns` | list | The puzzle's own stand-ins, beside the four every puzzle gets |
| `standIns[].id` | id | A neutral word |
| `standIns[].line` | line | How it plays |
| `standIns[].dials` | list | Its dials, each declared as a [setting](#settings) is |
| `standIns[].presets` | object | Named presets. Each gives a value for every dial under one name, such as `shark` |
| `absent` | stand-in id | The stand-in that plays a seat whose player is not there, or whose time for a wait has run out |
| `left` | `"absent"` or `"out"` | What a seat becomes when its player leaves and others stay: the absent stand-in's, or out of the round |
| `seatSettings` | list | Settings for one seat, whoever holds it. Each is declared as a setting is, and the host or a role sets it |

```json
{
  "opponents": {
    "sides": [2, 2],
    "seatsPerSide": [2, 2],
    "ghosts": false,
    "standIns": [{ "id": "partner", "line": "one rule that reads only its own seat's cards", "dials": [] }],
    "absent": "partner",
    "left": "absent"
  }
}
```

### `points`

Whose the accounts are, and when points count. Absent means points go to the seat that earned them, are banked as each event is paid, and the total stops at zero.

| Key | Type | Holds |
|---|---|---|
| `to` | `"seat"` or `"side"` | Whose each account is. Partners share a side's |
| `banks` | `"paid"` or a phase id | When points join the account: as each event is paid, or when the named phase closes. Until then they sit in that phase's tally |
| `floor` | `"total"` or `"tally"` | What stops at zero: the account's total, or the tally alone |

```json
{ "points": { "to": "side", "banks": "hand", "floor": "tally" } }
```

### `placing`

How the sides are put in order when a round ends.

| Key | Type | Holds |
|---|---|---|
| `by` | `"points"`, `"last-standing"` or `"rules"` | By each side's points, most first. By the order the sides went out, last first. Or by the rules' answer to [`placing`](/api/hooks#placing) |

## The board

The ideas are on [The board and its pieces](/domain/board-and-pieces).

### `board`

| Key | Type | Holds |
|---|---|---|
| `shape` | `"grid"` or `"rings"` | Which cells there are and which touch |
| `width`, `height` | number or setting | Grid only. Its size in cells |
| `touch` | `4` or `8` | Grid only. Whether cells touch on four sides, or on eight with diagonals |
| `rim` | boolean | Grid only. True when it has a ring of cells just outside the playing area, for ports, feeders and the like |
| `rings`, `sectors` | number or setting | Rings only. Ring 0 is innermost, sector 0 is at the top, and sectors count clockwise |
| `shared` | boolean | Between sides. True for one board all sides share, false for one board a seat |
| `seenBy` | `"everyone"`, `"seat"`, `"side"` or `"nobody"` | Who sees its pieces. Absent means everyone |

```json
{ "board": { "shape": "grid", "width": "width", "height": "height", "touch": 8, "rim": false } }
```

### `terrain[]`

What a cell is, as opposed to the piece on it: a wall, a block, a port. Terrain is plain unless declared here.

| Key | Type | Holds |
|---|---|---|
| `id` | id | A neutral word |
| `states` | list of names | Its states, if it has any, as a mirror that flips does |

### `zones[]`

A zone is a named place beside the board that holds a fixed number of pieces: a tray, a queue, a hand of cards.

| Key | Type | Holds |
|---|---|---|
| `id` | id | A neutral word |
| `holds` | number or setting | How many pieces it holds |
| `player` | `"watches"` or `"takes"` | Whether a player only watches it or takes pieces from it |
| `each` | `"round"`, `"seat"` or `"side"` | Whose it is. Absent means one for the round |
| `seenBy` | `"everyone"`, `"seat"`, `"side"` or `"nobody"` | Who sees what it holds. Absent means everyone |

```json
{
  "zones": [
    { "id": "hand", "holds": 13, "player": "takes", "each": "seat", "seenBy": "seat" },
    { "id": "trick", "holds": 4, "player": "watches" }
  ]
}
```

### `pieces[]`

Anything on the board or in a zone that the rules know about. How a piece looks and what it is called belong to the skin.

| Key | Type | Holds |
|---|---|---|
| `id` | id | A neutral word |
| `footprint` | cells | The cells it covers. Absent for a piece of one cell |
| `family` | setting, or a list of them | The setting that counts its kinds. The kinds are numbered from 1 and are not listed. A piece in more than one family names one for each, as a card is a rank and a suit |
| `of` | piece id | The piece it is based on. It behaves as that piece, with rules and states of its own on top |
| `states` | list of names, or `{ "count": number or setting }` | A few named forms, such as cold and hot, or a number it shows, such as the moves a fuse has left |

```json
{
  "pieces": [
    { "id": "kind", "family": "kinds" },
    { "id": "prize" },
    { "id": "timed", "of": "kind", "states": { "count": "timerFuse" } },
    { "id": "ruined" }
  ]
}
```

## What goes in

The ideas are on [Moves, events and signals](/domain/moves-and-events).

### `settings[]`

A setting is a named number the puzzle is tuned by. Its default is the only place that number lives.

| Key | Type | Holds |
|---|---|---|
| `id` | id | A neutral word |
| `type` | `"whole"`, `"percent"`, `"permille"`, `"list"`, `"flag"` or `"maps"` | A whole number, a percent, a permille, a list of numbers, a flag, or a list of hand-drawn maps |
| `default` | by type | The value the puzzle ships with |
| `min`, `max` | number | The bounds every host holds it to. For a list, the bounds of each entry |
| `line` | line | What it does |
| `group` | `"board"`, `"deal"`, `"tempo"` or `"scoring"` | Where it sits in a tuning panel |
| `unit` | `"seconds"`, `"ticks"`, `"moves"`, `"cells"`, `"pieces"` or `"points"` | What it counts. Absent for a plain count, a percent, a permille or a flag |
| `entries` | `{ "least", "most" }` or `{ "count" }` | List only. The fewest and most entries, or the setting or count that fixes how many |
| `map` | `{ "board", "check" }` | Maps only. The board each map fills, and the check every map must pass, such as every port reachable |
| `role` | boolean | True when a role may set it for a round, within its bounds. Absent otherwise |

```json
{
  "id": "kinds",
  "type": "whole",
  "default": 5,
  "min": 2,
  "max": 8,
  "line": "kinds dealt; more makes long paths harder to find",
  "group": "board"
}
```

A setting that a layer brings exists only while that layer is on.

### `relations[]`

What the settings must keep between one another, which no single setting's bounds can say.

| Key | Type | Holds |
|---|---|---|
| `is` | `"at-most"`, `"below"`, `"ascending"` or `"fits"` | The relation, from the table below |
| `a` | setting | The setting it holds for |
| `b` | setting, or `"board"` | What it is held against. Absent for `ascending` |

| `is` | Holds when |
|---|---|
| `at-most` | `a` is no more than `b` |
| `below` | `a` is less than `b` |
| `ascending` | The entries of the list `a` never fall |
| `fits` | The count `a` fits the board |

```json
{
  "relations": [
    { "is": "at-most", "a": "startPrizes", "b": "maxPrizes" },
    { "is": "at-most", "a": "maxPrizes", "b": "width" }
  ]
}
```

Every host holds a round's settings to their bounds and relations before it starts.

### `moves[]`

| Key | Type | Holds |
|---|---|---|
| `id` | id | A neutral word. It is the name the rules know the move by |
| `line` | line | What the move is |
| `gesture` | `"tap"`, `"long-press"`, `"draw"`, `"drag"`, `"swipe"`, `"slice"`, `"turn"` or `"hold"` | How a player makes it by touch. Keys follow from the gesture by one scheme, so no puzzle declares keys for a move |
| `inHand` | boolean | True when the move is built in hand first: a piece is taken, moved, turned or flipped, and only setting it down is the move |
| `fields` | typed fields | What the move carries. Each is `place`, `places`, `direction`, `piece`, `number` or `flag` |

```json
{
  "moves": [
    {
      "id": "trace",
      "line": "draw a path through touching pieces, closed or open",
      "gesture": "draw",
      "fields": { "path": "places", "closed": "flag" }
    }
  ]
}
```

The engine checks a move's fields against the board before the rules see it.

### `controls[]`

A control is a button the puzzle declares, for a move that has no place.

| Key | Type | Holds |
|---|---|---|
| `id` | id | A neutral word |
| `move` | move id, or `"none"` | The move it makes. None for a switch that only changes what a tap does |
| `key` | letter | The key that uses it |

### `signals`

Values that cross between the puzzle and whatever is outside it. A signal in steers the puzzle and is kept in the log. A signal out is read by a role.

| Key | Type | Holds |
|---|---|---|
| `in`, `out` | list | The signals in each direction, declared alike |
| `[].id` | id | A neutral word |
| `[].type` | `"number"`, `"flag"` or `"outcome"` | What it carries, when it carries one value |
| `[].fields` | typed fields | In place of `type`, when it carries several values. Typed as a move's are |
| `[].seat` | boolean | True when it is for one seat |
| `[].when` | `"on-change"`, `"sampled"` or `"at-end"` | When it flows |

```json
{
  "signals": {
    "in": [{ "id": "level", "type": "number", "when": "on-change" }],
    "out": [{ "id": "pace", "type": "number", "when": "sampled" }]
  }
}
```

## The deal

### `deal`

Everything luck puts in a round, declared in full. The ideas are on [The deal](/domain/deal).

| Key | Type | Holds |
|---|---|---|
| `draws` | list | Every source of luck |
| `checks` | list | The tests a deal must pass before a player sees it |
| `bounds` | list | The settings that cap what a draw can give |

### `deal.draws[]`

| Key | Type | Holds |
|---|---|---|
| `id` | id | A neutral word. Each draw has a stream of its own, made from the seed and this id |
| `line` | line | What it decides |
| `gives` | `"kind"`, `"piece"`, `"place"`, `"map"`, `"task"` or `"number"` | What it decides |
| `by` | `"even"`, `"weighted"`, `"bag"` or `"pick"` | How. An even roll, a weighted roll or a chance, a shuffled bag dealt in order, or a pick from a list setting |
| `when` | `"start"`, `"refill"`, `"task"`, `"tick"` or `{ "every": setting }` | When it is drawn. The last is every so many moves |
| `reads` | list of settings | The settings that size it |
| `shared` | boolean | Between sides. True when every seat reads one shared stream, false for a stream a seat |

The rules can only draw from a draw declared here.

### `deal.checks[]`

| Key | Type | Holds |
|---|---|---|
| `id` | id | A neutral word |
| `line` | line | What must be true of a deal |
| `draws` | list of draw ids | The draws it covers |
| `tries` | number | How many times the rules try |
| `fallback` | line | What is dealt when every try fails, and why it passes. A fallback always passes |
| `during` | event id | The event that says the board was dealt again, when the check also holds during play |

### `deal.bounds[]`

| Key | Type | Holds |
|---|---|---|
| `setting` | setting | The setting that caps |
| `caps` | draw id | The draw it caps |

```json
{
  "deal": {
    "draws": [
      { "id": "debris", "line": "the kind of each new piece", "gives": "kind", "by": "even", "when": "refill", "reads": ["kinds"] },
      { "id": "timer", "line": "which piece on the board becomes timed", "gives": "place", "by": "even", "when": { "every": "timerEvery" }, "reads": ["timerEvery"] }
    ],
    "checks": [
      {
        "id": "path", "line": "a path can be drawn", "draws": ["debris"], "tries": 50,
        "fallback": "lays a path of pathMin pieces of one kind, which can always be drawn",
        "during": "reshuffle"
      }
    ],
    "bounds": [{ "setting": "maxPrizes", "caps": "prize" }]
  }
}
```

## What comes out

### `events[]`

An event is something the rules report happened. Every change to the board and every number a player sees counted arrives on one.

| Key | Type | Holds |
|---|---|---|
| `id` | id | A neutral word |
| `line` | line | What happened |
| `fields` | typed fields | What it carries. Each is `place`, `places`, `piece`, `seat`, `side`, `number` or `points` |
| `mistake` | boolean | True when it is a mistake: something a player who plays well can always avoid |
| `changes` | list | The board changes it can carry: `arrive`, `leave`, `travel` or `change` |
| `step` | boolean | True when it counts as a step of a cascade |
| `closes` | phase id | The phase it closes |
| `reveals` | list | The zones it reveals, or `"board"`. A hidden piece can be read only on such an event |

```json
{
  "id": "loop",
  "line": "a closed path took every prize",
  "fields": { "path": "places", "inside": "places", "prizes": "number", "points": "points" },
  "changes": ["leave"]
}
```

A round's start, its countdown and its end are the host's, the same for every puzzle. They are never declared.

### `moment`

The one event that is the puzzle's biggest. A skin plays its beat on it.

| Key | Type | Holds |
|---|---|---|
| `event` | event id | The event |
| `when` | condition | An optional condition on the event's fields |
| `size` | field name | The number field that says how big each one is |
| `most` | number or setting | The value that counts as biggest |

```json
{ "moment": { "event": "loop", "when": "prizes > 0", "size": "prizes", "most": "maxPrizes" } }
```

### `gauges[]`

A number a player watches while the round is played, besides the score.

| Key | Type | Holds |
|---|---|---|
| `id` | id | A neutral word |
| `line` | line | What it counts |
| `most` | number or setting | Its most, where it has one |
| `danger` | number | The value past which it means danger |
| `each` | `"round"`, `"seat"` or `"side"` | Whether there is one for the round, for each seat or for each side. Absent means the round |

### `stats[]`

A count the rules keep about a round, shown when it ends.

| Key | Type | Holds |
|---|---|---|
| `id` | id | A neutral word |
| `line` | line | What it counts |

## Scoring

The rules report events. The points follow from what is declared here. The ideas are on [Scoring](/domain/scoring).

### `payouts[]`

Every point belongs to a payout: a named way the puzzle pays.

| Key | Type | Holds |
|---|---|---|
| `id` | id | A neutral word |
| `line` | line | What it pays for |
| `on` | list of event ids | The events it pays on |
| `counts` | field name | The event's field it grows from: a number, or places, counted. Absent for a flat payout |
| `growth` | `"flat"`, `"linear"`, `"superlinear"` or `"stepped"` | How its points rise with what it counts |
| `cap` | number or setting | The count past which it grows no faster. Absent when it has none |
| `reads` | list of settings | The settings that size it |

| `growth` | Points |
|---|---|
| `flat` | The same every time |
| `linear` | A setting times the count |
| `superlinear` | A setting times the count squared |
| `stepped` | A list of points, an entry for each count, whose last entry holds |

```json
{
  "id": "path",
  "line": "a path pays its length squared",
  "on": ["clear", "loop"],
  "counts": "path",
  "growth": "superlinear",
  "reads": ["pathPoints"]
}
```

### `multipliers[]`

A multiplier scales named payouts on an event by a percent. Multipliers that meet on one event multiply together, and the result is rounded down once.

| Key | Type | Holds |
|---|---|---|
| `id` | id | A neutral word |
| `line` | line | What it rewards |
| `scales` | list of payout ids | The payouts it scales |
| `on` | condition | The event, and the condition, it applies on |
| `by` | `{ "percent": setting }` or `{ "table": setting, "index": "streak" or "step" }` | One percent, or a list setting read at the streak's count or the cascade's step |

```json
{
  "multipliers": [
    { "id": "loop", "line": "closing a path multiplies its own points", "scales": ["path"], "on": "loop", "by": { "percent": "loopPercent" } },
    { "id": "streak", "line": "long paths in a row multiply everything", "scales": ["path", "inside", "prize_loop"], "on": "every event of a move and its cascade", "by": { "table": "streakPercent", "index": "streak" } }
  ]
}
```

### `streak`

A run of successes that raises a multiplier. A puzzle has at most one. Absent when it has none.

| Key | Type | Holds |
|---|---|---|
| `builds` | `{ "event", "when" }` or `{ "grade" }` | What builds it: an event with a condition on it, or a task's grade |
| `grace` | number | How many misses in a row it forgives before it breaks |
| `breaksOn` | list of event ids | The mistakes that break it at once |

### `tasks[]`

A task is a unit of work the deal sets within a round: a slab to cut, a posted bounty.

| Key | Type | Holds |
|---|---|---|
| `id` | id | A neutral word |
| `line` | line | What finishes it |
| `open` | number | How many can be open at once |
| `ends` | list | How it can end: `done`, `given-up` or `out-of-time` |
| `control` | control id | Given up only. The control that gives it up |
| `setting` | setting | Out of time only. The setting that times it |
| `graded` | `"par"`, `"best"` or `"none"` | Graded against the fewest moves that can finish it, against the most any play could score from it, or not at all |
| `grades` | list of names | Its grades, in order from best |
| `next` | `"dealt"` or a control id | Dealt as soon as one is needed, or asked for with a control |

## Depth and judgement

The ideas are on [Depth and judgement](/domain/depth-and-judgement).

### `layers[]`

A layer is a named group of rules that is either on or off.

| Key | Type | Holds |
|---|---|---|
| `id` | id | A neutral word |
| `rule` | line | The rule it adds |
| `brings` | object | What exists only while it is on, by id |
| `brings.pieces`, `events`, `settings`, `zones`, `gauges`, `controls`, `payouts`, `multipliers`, `tasks`, `draws` | lists of ids | Each list names declared parts of that kind. A kind with nothing to name is left out |

```json
{
  "id": "loops",
  "rule": "a closed path takes every prize at once",
  "brings": {
    "events": ["loop"],
    "settings": ["loopMin", "loopPercent", "insidePoints", "prizeLoopPoints"],
    "payouts": ["inside", "prize_loop"],
    "multipliers": ["loop"]
  }
}
```

### `ladder[]`

The puzzle's stages in order: how it opens up for a new player. It has two to four stages. Each layer is added by exactly one stage, no stage switches a layer off, and the last stage is `full`.

| Key | Type | Holds |
|---|---|---|
| `stage` | id | The stage's id. The last is `full` |
| `adds` | list of layer ids | The layers it switches on |
| `advance.measure` | `"best-round"`, `"average-of-last"`, `"wins-over-stand-in"` or `"rounds-played"` | What a player is measured by at this stage |
| `advance.threshold` | number | The bar to clear, in the measure's unit: points, wins or rounds. `full` has no `advance` |

```json
{
  "ladder": [
    { "stage": "paths", "adds": ["paths"], "advance": { "measure": "best-round", "threshold": 120 } },
    { "stage": "streak", "adds": ["streak", "prizes"], "advance": { "measure": "best-round", "threshold": 280 } },
    { "stage": "loops", "adds": ["loops", "bounty"], "advance": { "measure": "best-round", "threshold": 780 } },
    { "stage": "full", "adds": ["timers"] }
  ]
}
```

### `evaluation`

How a round is judged on the five tiers every puzzle shares.

| Key | Type | Holds |
|---|---|---|
| `tierStarts` | `{ "steady", "sharp", "masterful", "legendary" }` | The score at which each tier begins. For a puzzle judged by its score |
| `by` | `"outcome"` or `"score"` | Between sides. Whether a round is judged by who won or by its score |
| `paceWindowSeconds` | number | The stretch pace is read over: about two of the puzzle's scoring events |

```json
{
  "evaluation": {
    "tierStarts": { "steady": 850, "sharp": 2450, "masterful": 4800, "legendary": 8400 },
    "paceWindowSeconds": 10
  }
}
```

## Words and teaching

### `texts[]`

The keys a skin must give a text for. The puzzle declares the keys and their placeholders. The words themselves are the skin's.

| Key | Type | Holds |
|---|---|---|
| `key` | string | The key, such as `name` or `event.loop` |
| `placeholders` | list of names | The values a text for this key may show, such as `count` |

Every puzzle declares these keys, and may declare more.

| Key | The text |
|---|---|
| `name` | The puzzle's name |
| `how_to` | How to play |
| `stage.<id>`, `stage.<id>_intro` | Each stage's name and its one-line card, `full` included |
| `piece.<id>` | Each piece's name. A kind of a family is `piece.<id>_<n>` |
| `event.<id>` | An event's callout, for each event that has one |
| `stat.<id>` | Each stat's label on the result |
| `gauge.<id>` | Each gauge's label |
| `control.<id>` | Each control's label |

### `teaching`

| Key | Type | Holds |
|---|---|---|
| `preview` | boolean | Whether the board can tell what a move would do before it is made |
| `hint` | boolean | Whether the puzzle offers a move worth making to a player who is stuck. A round that counts never hints |

## When a puzzle is ready

A host checks all of this before it runs a round.

- Every part of the document is filled in.
- The ladder has two to four stages, each layer is added by exactly one, and the last is `full`.
- The rules know every part the document declares, and the document declares everything the rules name.
- The moment names one of the puzzle's events and a number field of it.
- Every draw has a stream of its own, every check has a fallback that passes, and every place that hides something has an event that reveals it.
- Every phase can close, every move belongs to a phase where the puzzle has phases, and every ending has a reason.
- The rules answer `onStart`, `canMove` and `onMove`.
- A puzzle between sides can list the moves a round allows, or brings a stand-in of its own. It names its absent stand-in and says how its sides are placed.
- The puzzle keeps witness rounds, each still giving the read recorded for it, and a history line for its current version.
- Its skin has a drawing for every piece, state and kind, a cue for every cue an event names, a text for every key, a beat cue, and a motion for every board change.

A puzzle that is not ready can still be edited and dressed. A puzzle with no rules yet cannot be played.
