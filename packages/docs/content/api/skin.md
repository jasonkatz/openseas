A skin document is one JSON file, `<id>.skin.json`. It dresses one puzzle in one theme: a drawing for every piece, the sounds, the motion and the words. A skin never sets a number and never changes a round. The ideas are on [Skins and themes](/domain/skins-and-themes) and [Motion](/domain/motion).

The examples are from the skin of Paths in the space theme, where the puzzle is called Salvage.

## The whole shape

| Key | Type | Holds |
|---|---|---|
| `puzzle` | puzzle id | The puzzle it dresses |
| `theme` | theme id | Its one theme. Every colour the skin names is one of that theme's |
| `pieces` | object | A [drawing](#pieces) for every piece, state and kind |
| `cues` | object | The skin's own copy of every [cue](#cues) it plays, by name |
| `motion` | object | How every board change [plays](#motion) |
| `events` | object | What the skin does [for each event](#events) |
| `texts` | object | A [text](#texts) for every key the puzzle declares |

## Pieces

`pieces` has one entry for each piece the puzzle declares. The key is the piece's id. A family needs an entry for every kind its setting allows, keyed `<id>_<n>` from 1.

| A piece with | Is written as |
|---|---|
| One form | A drawing |
| Named states | An object with a drawing under each state's name |
| A count | A drawing with a `count` layer, repeated once for each one counted |
| A base piece | A drawing with `over`, laid on top of the base piece's own drawing |

### A drawing

A drawing is a few flat layers on a square 24 units wide, painted in order in one colour.

| Key | Type | Holds |
|---|---|---|
| `tint` | colour name | One of the theme's colours |
| `layers` | list, 1 to 32 | The [layers](#a-layer), painted in order |
| `over` | piece id | The piece this drawing is laid over. The piece is drawn first, in its own colour |
| `count` | object | For a piece whose state is a number |
| `count.layer` | layer | The mark that is repeated |
| `count.step` | number | How far apart the marks sit, in units |

```json
{
  "kind_2": {
    "tint": "sky",
    "layers": [
      { "name": "upright", "kind": "rect", "x": 2.5, "y": 2.5, "w": 9, "h": 19, "r": 2.5 },
      { "name": "foot", "kind": "rect", "x": 2.5, "y": 12.5, "w": 19, "h": 9, "r": 2.5 }
    ]
  },
  "timed": {
    "over": "kind",
    "layers": [{ "name": "heart", "kind": "disc", "x": 12, "y": 12.6, "r": 2.6, "cut": true }],
    "count": { "layer": { "name": "notch", "kind": "disc", "y": 1.7, "r": 1.25 }, "step": 3.3 }
  }
}
```

### A layer

Every layer has a `kind`, and the keys that kind needs. Positions are in units of the square, from 0 to 24, and angles are in degrees.

| `kind` | Draws | Keys |
|---|---|---|
| `rect` | A rounded rectangle | `x`, `y`, `w`, `h`, and `r` for its corner |
| `disc` | A disc | `x`, `y`, `r` |
| `poly` | A filled polygon | `points`, as x, y pairs, and `round` for its corners |
| `bar` | A round-ended stroke between two points | `x0`, `y0`, `x1`, `y1`, `width` |
| `arc` | A stroked arc about a point | `x`, `y`, `r`, `from`, `to`, `width`, and `cap` to round its ends |
| `path` | A stroked line through points, with bends | `steps`, `width`, `cap`, and `fill` to fill it as one closed shape |

Any layer may also carry these.

| Key | Type | Holds |
|---|---|---|
| `name` | string | What the layer is called in an editor. Nothing draws it |
| `cut` | boolean | True to cut the shape out of what is drawn so far, so the ground shows through. It is the piece's one inner detail |
| `turn` | degrees | Turns the layer about the square's centre |
| `copies` | 1 to 12 | Draws the layer this many times in all |
| `spread` | degrees | How much further each copy is turned than the last, as a cog's teeth are |

### What every drawing keeps

These hold in every theme, because access and the painter need them.

- Each kind on a board is told from every other by its silhouette alone. Colour is never the only signal.
- A drawing is made on the 24 unit square.
- A piece has one colour and at most one inner detail, cut out of it.

## Cues

A cue is a short synthesized sound. `cues` holds the skin's own copy of every cue it plays, by name. A new skin starts from a copy of its theme's cues, so a puzzle can revoice its own without changing how any other board sounds.

| Key | Type | Holds |
|---|---|---|
| `level` | number | The cue's level. 1 is about the peak every cue is tuned to |
| `cutoff` | hertz | The low-pass the whole cue passes through |
| `voices` | list, 1 to 16 | The [voices](#a-voice) that sound |
| `shift` | object | Moves every tone up or down the scale by a value the board passes, as a cascade climbs |
| `swell` | object | Scales the level from `from` to `to` as a value the board passes goes from 0 to 1 |
| `alt` | object | Another `level` and `cutoff` while a `when` holds |

### A voice

| Key | Type | Holds |
|---|---|---|
| `kind` | `"tone"` or `"air"` | A note of the scale, or a breath of soft noise through a moving filter |
| `at` | seconds | When it starts, after the cue starts |
| `attack` | seconds | How long it takes to rise from silence to full |
| `release` | seconds | How long it takes to fall back to silence |
| `level` | 0 to 1 | How loud it is within the cue |
| `note` | step | Tone only. A step of the theme's scale, where 0 is its lowest note |
| `wave` | `"sine"` or `"triangle"` | Tone only |
| `fixed` | boolean | Tone only. True to stay where it is when the cue is shifted |
| `from`, `to` | hertz | Air only. The filter's cutoff as the breath starts and as it ends |
| `band` | boolean | Air only. True for a band-pass, as a whoosh is. False for a low-pass, as a thump is |
| `when` | `{ "param", "from", "to" }` | Sounds only while a value the board passes is in this range |
| `repeat` | `{ "param", "min", "max", "note", "at" }` | Sounds again a number of times the board says, each a few steps and a moment after the last |

```json
{
  "good": {
    "level": 1,
    "cutoff": 2200,
    "voices": [
      { "kind": "tone", "note": 10, "wave": "triangle", "at": 0, "attack": 0.012, "release": 0.088, "level": 0.8 },
      { "kind": "tone", "note": 13, "wave": "triangle", "at": 0.08, "attack": 0.012, "release": 0.168, "level": 1 }
    ]
  }
}
```

Every cue must stay inside its theme's [sound frame](/api/theme#sound): each note is one of the scale's, no cue is longer than the frame allows, and no cutoff is higher.

## Motion

`motion` says how everything on the board plays. No length of motion is ever a setting or written in the puzzle.

| Key | Type | Holds |
|---|---|---|
| `changes` | object | One entry for each board change: `arrive`, `leave`, `travel` and `change` |
| `changes.<change>.ms` | milliseconds | How long it takes |
| `changes.<change>.ease` | `"linear"`, `"in"`, `"out"` or `"in-out"` | How it eases |
| `changes.leave.as` | `"shrink"` or `"fade"` | How a piece leaves |
| `stagger` | milliseconds | The gap between the places of one event, so a path plays in the order it was drawn |
| `beat.ms` | milliseconds | How long the beat's pulse lasts |
| `beat.color` | colour name | One of the theme's colours |
| `beat.strength` | `{ "from", "to" }` | The pulse's strength for the smallest moment and for the biggest |
| `reduced.changes` | `"cut"` or `"as-is"` | What board changes do when the player asks for reduced motion |
| `reduced.beat` | `"still"` or `"as-is"` | What the beat does then |

```json
{
  "motion": {
    "changes": {
      "arrive": { "ms": 120, "ease": "out" },
      "leave": { "ms": 160, "ease": "out", "as": "shrink" },
      "travel": { "ms": 120, "ease": "out" },
      "change": { "ms": 0 }
    },
    "stagger": 46,
    "beat": { "ms": 420, "color": "yours", "strength": { "from": 0.14, "to": 0.3 } },
    "reduced": { "changes": "cut", "beat": "still" }
  }
}
```

The host caps what one entry's motion can cost. Whatever a move sets off plays for at most about a second, and past that the host snaps it to its end.

## Events

`events` has an entry for each event the puzzle declares, and for the host's three: `start`, `countdown` and `end`.

| Key | Type | Holds |
|---|---|---|
| `cues` | list of cue names | The cues it plays. The list may be empty |
| `marks` | list | Rings at places, or lines through places, drawn from the event's own place fields to show a rule at work |
| `marks[].ring` | field name | A place or places field to ring |
| `marks[].line` | field name | A places field to draw a line through |
| `points` | field name | The place field the event's points rise from |
| `callout` | rank | Its callout's rank, 1 the highest. One entry shows at most one callout: the highest it earned |

```json
{
  "events": {
    "clear": { "cues": ["pop"], "points": "path" },
    "loop": { "cues": ["slag"], "marks": [{ "line": "path" }], "points": "path", "callout": 2 },
    "blowup": { "cues": ["crack"], "marks": [{ "ring": "place" }], "callout": 1 },
    "start": { "cues": ["start"] }
  }
}
```

The beat plays on the puzzle's [moment](/api/puzzle#moment). It has one cue of its own, named `beat`, heard alone with no other cue over it.

## Texts

`texts` has one entry for each key the puzzle [declares](/api/puzzle#texts). A text keeps its key's placeholders, written in braces.

```json
{
  "texts": {
    "name": "Salvage",
    "piece.prize": "Loot crate",
    "event.loop": "Netted {prizes}",
    "gauge.prizes": "Crates adrift: {count} of {max}",
    "stat.longest": "Longest line"
  }
}
```

## When a skin is ready

A skin has no version of its own. It must be ready against its puzzle's current version, and that is checked whenever the version rises.

- A drawing for every piece, every named state and every kind a family's setting allows.
- A cue for every cue an event names, and a `beat` cue.
- A motion for every board change.
- A text for every key, with its placeholders kept.
- Every colour it names is in its theme's palette.
