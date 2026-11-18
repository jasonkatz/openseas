# openseas — Brand book

The game's look and feel: **lo-fi minimalist space**. Flat, dark, warm and quiet. This file is the
source of truth for how anything in the game looks, moves and sounds (ADR 0061, ADR 0062). The
pictures that go with it are in [`brand/specimen.html`](./brand/specimen.html): open it in a
browser. When this file and a board disagree, fix one in the same PR.

It covers the game, its boards and its guides. The studio's chrome keeps its own look (ADR 0058);
only the boards inside it follow this book.

**Status.** The direction and the palette are decided, and milestone M10 (`DESIGN.md` 5.2) is
restyling the game to them in steps. `DESIGN.md` 3.10 says what is built so far.

## 1. The idea

A small ship, a long way from anywhere, with the lights turned down. The game is a pleasant place
to sit between puzzles.

- **Flat.** Solid fills. No gradients, gloss, texture, bevels, shadows, glows or blur.
- **Quiet.** A lot of empty ground. One thing asks for attention at a time.
- **Warm.** Dark, never cold: cream on blue-black, an amber lamp, muted colour.
- **The same everywhere.** One palette, one typeface, one corner, one way of moving, one beat.

The scrappy pirate character is in the **words**, not the pictures (section 9). Nothing is drawn
with rivets, rust, tape or skulls.

## 2. Colour

One palette for the whole game. No puzzle, screen or scene has colours of its own.

### Ground and text

The owner's pick, Night watch: the old navy, parchment and brass, muted and narrowed.

| Role | Value | Used for |
|---|---|---|
| `ground` | `#0b1220` | The page, a board's playfield, the void |
| `raised` | `#141d30` | A panel, a button, a field |
| `line` | `#27344f` | A hairline, a border, an empty cell's dot |
| `cream` | `#ece3cf` | Text, icons, lines that carry meaning |
| `dim` | `#8f99ad` | Secondary text, a label, a disabled thing |
| `amber` | `#e2a94b` | **Yours and active**, and the beat |
| `danger` | `#e5604e` | **Bad**: heat, damage, a refusal |

### Two colours mean something

- **Amber** is what is yours or active: your piece, your ship, the thing selected, the button that
  goes on, focus, and the beat (section 6). Nothing else is amber, and no piece kind is.
- **Danger** is what is bad. Nothing else is that red.

Every other colour is free: it means whatever a puzzle needs, and the same colour may mean
different things on two boards.

### Piece colours

Eight, shared by every puzzle. A puzzle uses as many as it has kinds.

| Name | Value | | Name | Value |
|---|---|---|---|---|
| `sand` | `#d8c690` | | `rose` | `#d897b2` |
| `sky` | `#7fb0d8` | | `teal` | `#6dbcb1` |
| `moss` | `#8ebd88` | | `rust` | `#c27f66` |
| `lilac` | `#a99ad4` | | `slate` | `#7f8ba3` |

`cream` is also a piece colour, for a special piece. `slate` is for a dead or inert piece.

### Player colours

A pirate's jacket and a crew's flag take one of twelve: the eight above, and `plum` `#8e6fa8`,
`olive` `#a3a86a`, `ice` `#a9d3de`, `brick` `#a85f5a`. Content files name them; they hold no hex. A flag's
field and emblem may also be `cream` or `ground`, for the light and the dark a flag needs. There is
no black jacket: the darkest is `olive`.

### Rules

- Dark only. There is no light theme.
- A colour is never the only signal (section 3, rule 6 of the project).
- No hex value is typed in a renderer, a scene or a stylesheet. Every colour comes from the token
  module in `boards`, and a test fails on a literal.

## 3. Shape

Pieces are **drawn in code** (ADR 0062), as **pictograms**: a simplified picture of the thing a
piece is called, reduced to geometry. A cog is a toothed disc, a bolt is a hexagon, a fuse is a
capsule. Each is a drawing of a few layers on the 24 unit square, kept as data in
`packages/boards/data/pieces/<puzzle>.json`, painted by one painter and redrawn in the studio's
Sprites editor, which notes where a drawing breaks a rule below (ADR 0065).

- **One silhouette a kind.** No two kinds on a board share an outline. A kind is told from every
  other by its silhouette alone, with the colour taken away: the specimen has a switch that shows
  this, and a new piece is checked with it. There is no marks setting.
- **Where the rules fix the outline, the cut-out tells the kinds apart.** Some pieces cannot have an
  outline of their own: blocks that fuse into slabs, plates cut to a footprint, a kind that is two
  things at once (a star's shape and its colour). There each kind carries one cut-out detail no
  other kind has, and that detail does the outline's job: it must read with the colour taken away.
- **Solid fill, no outline.** One colour a piece.
- **At most one inner detail,** cut out of the piece so the ground shows through. Never a second
  colour.
- **Rounded.** Drawn on a 24 unit square. The piece fills 20 units, every corner is rounded by at
  least 2, and no part is thinner than 3. It has to read at 24 pixels.
- **A puzzle keeps its subject.** Cooling is machine parts, Space Battle is ships. What they share
  is the palette and these rules, not their shapes.

### A board

- No frame. The playfield sits on the `ground` with nothing round it, or a single `line` hairline
  where its edge matters.
- No grid lines. Pieces imply the cells. A board where an empty position matters draws a small
  `line` dot in it.
- A gauge is a plain bar or a number. A light is a dot.
- A selection is an `amber` ring round the piece, 2 units wide, 2 units off it.

## 4. Type

One family for everything.

- **Atkinson Hyperlegible**, regular and bold. Titles, body, buttons, labels.
- **Atkinson Hyperlegible Mono** for anything counted: a score, a clock, a price, a seed.

| Step | Size | Weight | Used for |
|---|---|---|---|
| Title | 28px | Bold | A screen's name |
| Heading | 20px | Bold | A panel's name |
| Body | 16px | Regular | Everything read |
| Small | 13px | Regular | A label, a caption, in `dim` |
| Number | 16px to 40px | Mono, bold | A score |

Sentence case everywhere. No capitals for emphasis, no letter-spaced labels, no italics, no
display face.

## 5. Chrome

- A panel is a `raised` rectangle with one corner radius, **10px**. No border unless it sits on
  `raised` itself, then a `line` hairline.
- No glass, no blur, no shadow, no gradient, no glow.
- A button is `raised` with `cream` text. The one button that goes on is `amber` with `ground`
  text. A screen has at most one of those.
- An icon is a line drawing in the text colour, 1.5px, on the pieces' 24 unit square.
- Text over the world sits on a `ground` scrim at 70 percent, the one translucent thing allowed.
- Spacing is in fours: 4, 8, 12, 16, 24, 32.
- A touch target is at least 44px.

## 6. Motion

- **Short and eased.** A move is 120ms, a panel 180ms, ease-out. Nothing bounces or overshoots.
- **A clear** is the pieces shrinking to nothing in 160ms. No sparks, shards or smoke.
- **No screen shake, no particles** by default. A board may ask for a few where a rule needs
  showing (venting, a breach); the fewest that say it.
- **The beat.** A big moment, a large combo or a won fight, gets one thing: the whole board pulses
  once in `amber`, 420ms, with one sound. A bigger moment is a slightly stronger pulse, never a
  second effect. It is the same on every board.
- Reduced motion turns moves into cuts and keeps the beat as a still flash.

## 7. The world

The world is already flat-coloured primitives, and stays so.

- Its colours come from the shared palette. Rock and hull are `raised`, `line` and `slate`;
  a lit window, a beacon and your own ship's trim are `amber`.
- The void is `ground` with a sparse field of small `cream` stars. No nebula.
- One soft key light and an ambient fill. No hard shadows, no rim light, no post-processing.
- Another pirate's ship has a dark plate band where yours has amber trim. Amber trim is for your
  own ship and the one you are aboard.
- A light that is not a lamp (a screen, a hologram, a nav light) is a muted piece colour, never amber.
- A face turned to the light is its token's colour; a face turned away sits a little under it. That
  is the only shading.
- A few things may be translucent because they are glass or air: a helmet, a canopy, a beacon's beam,
  vapour, and the soft disc under a figure's feet.
- The world's tints are in one file, `client/src/world/tones.ts`, all made from the tokens.
- Geometry does not change.

## 8. Sound

Built (M10 step 6). Every cue is defined as data in `packages/boards/data/cues.json`, read by
`packages/boards/src/cues.ts` and played by `audio.ts` beside it; tests hold all three to what
follows, and the studio's Sounds editor holds a revoiced cue to it before it plays (ADR 0065).

- Cues are synthesized in code. No samples.
- **One voice.** A cue is a few voices from one small set: a sine, a triangle, a breath of
  filtered noise. Soft and warm: an attack of at least 8ms, everything through a low-pass at
  2.4kHz or lower, nothing sharp or metallic, mono.
- **One key.** Every pitched note is a step of G major pentatonic (G, A, B, D, E) across three
  octaves, G2 to G5: the constant `SCALE`. Any two cues sound well together.
- **Up is good, down is not.** What rises steps up the scale, what falls steps down. A bad thing
  is low and soft, never a buzzer: the heat alarm is two low notes.
- **Short and level.** Under 400ms, and every cue peaks within 3 dB of one quiet target.
- **The beat** (section 6) has one sound: the root, its fifth and its octave, low, ringing for
  700ms, a little louder for a stronger beat. It sounds alone: no other cue plays over it.
- No music and no ambient bed.

## 9. Words

The character the pictures no longer carry.

- Dry, warm, a little worn. The ship is held together by people who like each other.
- Short sentences. Plain words. A joke is one line and never explains itself.
- A thing is called by its glossary name (`GLOSSARY.md`).
- No pirate dialect, no exclamation marks, no capitals for effect.

> Seven clears on the trot. The captain almost smiled.

> The heat sinks are holding. Nobody is sure why.

Every string still goes through the message table (rule 5).

## 10. What this book leaves out

- **The name and a logo.** `openseas` stays a codename, set in plain type.
- **The studio's chrome** (ADR 0058).
- **A second theme.**
