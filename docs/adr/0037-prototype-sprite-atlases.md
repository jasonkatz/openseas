# 0037. Prototype boards draw from sprite atlases

Status: Accepted. Builds on [0031](./0031-shared-puzzle-sprite-atlases.md) and
[0036](./0036-prototype-puzzles.md). Supersedes the placeholder-only art of 0036 decision 4 and the
order of 0036 decision 5, where sprites came only after a puzzle was kept.

## Context

ADR 0036 gave the eight prototypes code-drawn placeholder art and left the sprite pass for a puzzle
that is promoted. The owner has since made sprite sheets for all eight and asked for them on the
boards now: a puzzle is judged on the harness, and it is judged more fairly in the art it would
ship with.

The seven core boards already load atlases (ADR 0031), each through its own hand-built renderer.
The prototypes share one kit, and they must stay cheap to drop.

## Decision

- **Eight more atlases live beside the seven**, in `boards/src/sprites`, in the same format: one
  WebP a puzzle, 192px frames on a 196px stride, named in the shared `frames.json`. A frame is
  named for what the renderer asks for: a kit kind's id (`debris-gold`), a charge, a grade.
  `scripts/pack-prototype-sprites.py` packs them from the delivered sheets.
- **The kit loads and paints them.** `KitBoard` loads the atlas named by its puzzle id before it
  makes the canvas, says which it got in `data-sprite-atlas`, and gives a renderer one call:
  `this.sprite(g, name, x, y, size)` paints a frame into a Graphics and returns false when there is
  no such frame. A renderer writes `this.sprite(...) || drawPiece(...)`.
- **The code-drawn art stays, as the fallback.** An atlas that fails or times out, a kind past the
  sheet (a lab config with more kinds, a grade past seven) and anything the sheets do not cover are
  drawn as before. A prototype is never unplayable for want of an image.
- **A frame is drawn down once to the size it is shown at**, on a 2D canvas, and kept for the
  board's life. A 192px frame sampled straight into a 40px cell shimmers. The textures are not
  freed at a layout, since a layer the layout does not redraw still holds its fills.
- **Everything that says something exact stays in code:** hit areas, geometry, animation, the mark
  setting's pips and numerals, Scanner's ping numbers and shading, Reactor's ports, Cutting's piece
  outlines, beam routes and counts. Over a sprite the pips sit on a dark plate (`drawMark`), since
  painted art has no flat face for them (rule 6).
- **Legends show the same frames.** `SpriteIcon` crops a frame out of the atlas for a harness
  legend and shows the vector icon until the atlas has loaded.
- **The smoke covers them** as it does the core seven: each atlas is delivered by a production
  build and drawn, and a kit board with no images still plays.

## Consequences

A prototype now costs one more file to drop: its atlas, with its entry in `frames.json` and its
line in `atlas.ts`. About 0.8 MB of art is added to the build; a page requests only its own atlas.
Promotion no longer waits on art. Sprites do not make a prototype part of the game: it is still
dealt only on the harness.

## Alternatives considered

- **Wait for promotion, as 0036 said.** The sheets exist and the owner wants to judge with them.
- **Hand-wire each renderer to the atlas, as the core boards are.** Eight copies of the same
  loading, fallback and texture-ownership code; the kit exists so that is written once.
- **Drop the code-drawn art.** Lab configs reach kinds and grades the sheets do not have, and
  ADR 0031 already holds that a failed image must not stop play.
