# 0061. The game looks lo-fi and minimalist, by a brand book: one palette, one typeface, no frame, no marks

Status: Accepted. Builds on [0034](./0034-space-setting.md). It leaves
[0058](./0058-the-studios-chrome-has-a-look-of-its-own.md) as it is: the studio's chrome keeps its
own look. [0062](./0062-pieces-are-drawn-in-code-and-cues-stay-synthesized.md) holds the half of
this that retires the sprite and sound pipelines.

## Context

The game's look grew a piece at a time. The boards are painted 2D art with navy outlines, worn
paint and rivets, inside a riveted gunmetal frame with cream trim and hazard stripes. The world is
flat-coloured primitives. The chrome is navy, parchment and brass with a storybook serif. Colours
are typed in five places and about 160 times across the board renderers, and each puzzle has its
own. `DESIGN.md` has said from its third line that art direction is still to land.

The owner asked for a lo-fi minimalist space theme, for coherence and calm, and settled what that
means over an interview of 33 questions. This ADR records the answers. The look itself is written
in `docs/BRAND.md`, which is the source of truth from here on.

## Decision

1. **`docs/BRAND.md` is the brand book and the source of truth for look, motion, sound and voice.**
   `docs/brand/specimen.html` shows it. A change to the look changes the book in the same PR.
2. **Flat vector, cosy, dark only.** Solid fills and simple geometry, no gradients, gloss, texture,
   shadow, glow or blur. Dark and warm, not cold. One theme.
3. **One palette for the whole game.** A ground, a raised surface, a line, cream, a dim text
   colour, eight muted piece colours and twelve player colours. It evolves from the current navy,
   parchment and brass. The owner picked its ground, Night watch, from three candidates on the
   specimen.
4. **Two colours have a fixed meaning.** Amber is yours and active. One danger colour is bad.
   Every other colour is free on each board.
5. **One token module in `boards` holds every colour,** and makes the CSS variables, the boards'
   constants and the world's colours. A test fails on a hex literal in a renderer, a scene or a
   stylesheet.
6. **One typeface.** Atkinson Hyperlegible for everything and its mono companion for numbers.
   Fraunces goes.
7. **The board's frame goes.** A playfield sits on the ground with no hull, no rivets and no grid
   lines. `boards/src/hull.ts` is removed as its last board is restyled.
8. **The marks setting goes.** A kind is told from every other by its silhouette alone, checked
   with the colour taken away. The second half of the project's rule 6, `DESIGN.md` 3.9 and item 22 of
   the `puzzles` skill are rewritten with this ADR: the owner judged the marks to add nothing. The
   setting's code goes from each board as M10 restyles it, and from the game's menu with the last.
9. **Motion is restrained, with one beat.** Short eased moves, no shake, few or no particles. A
   big moment is one amber pulse of the whole board with one sound, the same on every board.
10. **The chrome is flat.** No glass, one corner radius, line icons. A scrim behind text over the
    world is the one translucent thing.
11. **The world is recoloured and quietened, not rebuilt.** Its palettes move to the shared one,
    the nebula becomes a sparse starfield, the lighting is simplified. Geometry stays.
12. **The character moves into the words.** The scrappy frontier tone is carried by names and
    messages, not by drawn wear. The sprite style line is retired with the sprites (ADR 0062).
13. **Player colours come from the palette.** Jackets and flags in `content` name one of twelve
    palette colours.
14. **There is one look.** No setting brings the old one back.
15. **The guides take the tokens.** Their colours and typeface come from the token module. Their
    layout does not change, and their pictures are recaptured as each board is restyled.
16. **The name and a logo are not decided here.** `openseas` stays the codename.
17. **It is milestone M10, in six steps,** each its own pull request or run of them: the brand
    book and these ADRs; the token module, the chrome and Cooling; the other six boards in the
    game, one each; the world; the eight prototypes and the removal of the sprite tooling; the
    sound pass. The owner approves the look on the specimen at the first step and on a real board
    at the second, before the rest is drawn.

## Consequences

Every board is redrawn. Until M10 ends the game shows two looks at once, restyled boards beside
painted ones, and the steps are ordered so that state is short for the game's own seven. Guide
pictures are recaptured board by board. No test compares pixels, so nothing breaks on the way, and
equally nothing but the owner's eye and the hex test holds the look in place afterwards. Losing the
marks setting removes an aid some players may have used; silhouettes now carry that alone, so a
weak silhouette is an accessibility bug.

## Alternatives considered

- **Pixel art, low-poly or a retro monitor look.** Pixel art fights the three.js world, and the
  monitor look is a filter over a style, not one.
- **A cold, clinical minimalism.** An MMO is idled in; it should be pleasant to sit in.
- **A palette for each puzzle.** That is today's look in simpler drawings.
- **Keep a display typeface.** The character is in the words.
- **Keep the marks setting.** The owner chose silhouettes alone.
- **Restyle in one sweep.** A look is only real on a board, and one board is a cheap place to find
  it wrong.
