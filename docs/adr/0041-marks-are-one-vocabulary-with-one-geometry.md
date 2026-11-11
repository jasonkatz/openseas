# 0041. Marks are one vocabulary in content, with one geometry and an adapter for each surface

Status: Accepted. Builds on [0009](./0009-world-content-as-files.md) and
[0031](./0031-shared-puzzle-sprite-atlases.md), which kept the marks code-drawn over the sprites.

## Context

Rule 6 asks for a player setting that draws a distinct mark on every kind. Content names each kind's
mark: the pieces of Cooling, Engines, Plating, Gunnery and Swordfighting, and Navigation's colors.
Seven names are in use: circle, square, triangle, diamond, hexagon, star and gear. The name was a free
string, and six painters drew it: Cooling's badge on a 2D canvas, which Engines, Gunnery and
Swordfighting imported; Navigation's symbol in Pixi and a copy of it in SVG for its legend; an outline
in Engines' renderer, which Plating and Swordfighting imported; Plating's Unicode glyphs; and Space
Battle's glyphs on the two ships.

They had drifted. Navigation drew a small circle for a star or a gear. Plating drew its square for a
gear, and a square for a kind with no mark. So a content edit could give two kinds marks that look
alike, and startup would not see it.

## Decision

- **Content holds the vocabulary.** `MARK_NAMES` in `content/src/marks.ts`; every `mark` field is
  `MarkNameSchema`, so startup refuses any other name. It already refused two kinds of one puzzle
  with the same mark.
- **Each name has one geometry, beside it.** `MARK_GEOMETRY` gives each an outline and an optional
  hole, as circles and polygons in a box from -1 to 1. A name cannot be added without its shape. The
  shapes are Cooling's, the one painter that drew all seven. They live in content because the
  vocabulary does, and there a test can prove no two shapes are alike, at any size.
- **`boards/src/marks` holds one adapter for each surface a board draws on:** Canvas 2D
  (`paintMarkShape`, and `paintMark`, the light badge a baked piece wears), Pixi (`drawMarkShape`)
  and SVG (`MarkGlyph`). A board chooses where a mark goes, how big its box is and how it is painted,
  never its shape. A kind with no mark, a lab kind past content's list, draws none rather than
  another kind's.
- **The prototypes keep their pips.** The kit marks a kind with a count of pips by its index, not a
  name from content (ADR 0036, 0037), and draws them itself.

## Consequences

- A new mark is a name and a shape in one file, and every board can draw it.
- Where a painter's shapes differed from Cooling's, its marks moved a little: Navigation's and Engines'
  circles are smaller and their triangles sit lower, Plating's plates show shapes in place of font
  glyphs, and the player's ship in Space Battle shows its circle, which its glyph barely did.
- The circle and the hexagon are the nearest pair; the test holds them apart.

## Alternatives considered

- **The geometry in `boards`.** The shapes would live a package away from the names they draw, and
  the vocabulary and its shapes could drift apart again.
- **One surface for every mark, baked to a texture.** The Pixi boards draw marks live as fills and
  outlines in their own colors, and the legends are SVG; each would pay for a texture to save an
  adapter of twenty lines.
