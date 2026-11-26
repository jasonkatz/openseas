A theme document is one JSON file, `<theme>.theme.json`. A theme dresses every puzzle in one look, such as space. It holds what its skins share, and it has a skin for each puzzle. The ideas are on [Skins and themes](/domain/skins-and-themes#themes).

The examples are from space, the first theme.

## The whole shape

| Key | Type | Holds |
|---|---|---|
| `id` | id | The theme's id, such as `space` |
| `palette` | object | Every [colour](#palette), a name and a value |
| `type` | object | Its [typefaces and sizes](#type) |
| `sound` | object | The [sound frame](#sound) every cue must stay inside |
| `cues` | object | The [starting cues](#starting-cues-and-motion): what a new skin copies |
| `motion` | object | The starting motion: what a new skin copies |
| `texts` | object | The [host's words](#host-texts) in this theme |

## Palette

| Key | Type | Holds |
|---|---|---|
| `fixed` | object | The seven fixed colours, which every theme fills |
| `pieces` | object | The piece colours: names the theme chooses freely, each with a value. At least eight, because a family can deal eight kinds |
| `names` | object | The theme's own name for a fixed colour, where it has one |

The seven fixed colours mean the same thing in every theme, so a host and any skin work under any theme.

| Fixed colour | Is used for |
|---|---|
| `ground` | The page and a board's playfield |
| `raised` | A panel, a button, a field |
| `line` | A hairline or a border |
| `text` | Text and anything that carries meaning |
| `dim` | Secondary text and labels |
| `yours` | What is the player's, or active |
| `danger` | What is bad |

```json
{
  "palette": {
    "fixed": {
      "ground": "#0b1220", "raised": "#141d30", "line": "#27344f",
      "text": "#ece3cf", "dim": "#8f99ad", "yours": "#e2a94b", "danger": "#e5604e"
    },
    "pieces": {
      "sand": "#d8c690", "sky": "#7fb0d8", "moss": "#8ebd88", "lilac": "#a99ad4",
      "rose": "#d897b2", "teal": "#6dbcb1", "rust": "#c27f66", "slate": "#7f8ba3"
    },
    "names": { "text": "cream", "yours": "amber" }
  }
}
```

A skin names a colour and the theme says what it is. Recolouring a theme recolours every board in it. A theme has one palette: a light look is a theme of its own.

## Type

| Key | Type | Holds |
|---|---|---|
| `faces.text` | typeface | The face for everything read |
| `faces.numbers` | typeface | The face for anything counted: a score, a clock |
| `sizes` | object | The steps of its type scale, by name |
| `sizes.<step>.px` | number | The size |
| `sizes.<step>.weight` | `"regular"` or `"bold"` | The weight |

```json
{
  "type": {
    "faces": { "text": "Atkinson Hyperlegible", "numbers": "Atkinson Hyperlegible Mono" },
    "sizes": {
      "title": { "px": 28, "weight": "bold" },
      "heading": { "px": 20, "weight": "bold" },
      "body": { "px": 16, "weight": "regular" },
      "small": { "px": 13, "weight": "regular" }
    }
  }
}
```

## Sound

The sound frame is data the checks read. Every cue of every skin in the theme must stay inside it, so any two cues sound well together.

| Key | Type | Holds |
|---|---|---|
| `scale` | list of notes | The notes every cue's notes come from. A [voice](/api/skin#a-voice) names a step of this list |
| `longestMs` | milliseconds | The longest a cue may last |
| `cutoff` | hertz | The highest any cutoff may be |

Space's sound frame is G major pentatonic from G2 to G5, with no cue over 400ms and no cutoff over 2.4kHz.

## Starting cues and motion

| Key | Type | Holds |
|---|---|---|
| `cues` | object | A whole [cue](/api/skin#cues) under each name, including one for each moment a host plays |
| `motion` | object | A whole [motion](/api/skin#motion), as a skin's |

These are copied, not read. A skin copies them when it is made, so each puzzle can then revoice its own. Changing a theme's starting cues or motion changes no skin by itself. Whoever changes them can carry the change to every skin of the theme in one step, or to one skin at a time, and is shown which skins had changed their own copy before those are overwritten.

Space's starting motion is a travel of 120ms, a clear of 160ms, ease-out, and a pulse of 420ms.

## Host texts

The words the host says in this theme.

| Key | The text |
|---|---|
| `tier.<id>` | A name for each of the five tiers |
| `start` | What the host says as a round starts |
| `countdown` | What it says as a round runs down |
| `end` | What it says when a round ends |

## What stays the host's

A theme does not say where anything sits on a screen, what shape a host's own controls have, or anything about a host's world. Those stay the host's.

## When a theme is ready

A host checks this before it uses a theme.

- Every fixed colour is filled, and it has at least eight piece colours.
- Every colour its skins name is in its palette.
- Every starting cue's notes are in its scale and within its limits.
- Its type names its faces and sizes.
- It has a text for every host key.
- It has a skin for every puzzle the host deals.

A new theme starts as a copy of another, skins and all, so every board plays from the first minute. Its skins may then redraw any piece as a different subject, within [what every drawing keeps](/api/skin#what-every-drawing-keeps).
