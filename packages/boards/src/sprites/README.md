# Puzzle sprites

Original art for OpenSeas. These are raster illustrations, not assets extracted from Puzzle
Pirates. The first set (2026-11-07) was nautical; the owner's sprite pass (2026-11-10) replaced
all seven source sheets with space parts under the same frame names, so the manifest did not
change. Every frame is now a lossless file of its own, and the build packs each puzzle's atlas from
them (ADR 0054); the source sheets are not kept.

## Style and coverage

Every sheet is painted to the style line in `../../briefs/sprite-style.txt`. No text is baked into
sprites. Keep optional accessibility badges and labels in code.

| Puzzle | Runtime use |
|---|---|
| engines | Trefoil, ring and three-spoke discs and their hollow targets; the extra lab kind stays procedural |
| swordfight | Four single-cell block and breaker skins, stone and ripening stone |
| battle | Friendly and raider starfighters, asteroids, gravity wells and slugs |

The eight prototype boards (ADR 0037) each have an atlas too, painted through the board kit:

| Puzzle | Runtime use |
|---|---|
| salvage | Six kinds of debris (`debris-<kind>`), the loot crate, the coupler |
| overload | A capacitor at each charge, 0 to 4 (`charge-<n>`), and a booster at each (`booster-<n>`) |
| deflectors | The `/` and `\` mirrors; a sign and a hollow target for each of the three beams |
| reactor | Rod casings for grades 1 to 7 (`grade-<n>`); the hot rod, whatever its grade |
| scanner | Fog and clear plates; found, spooked and miss marks; the ping diamond; lock and bare brackets |
| tug | Four pods (`pod-<kind>`), their four clamps (`clamp-<kind>`), the block |
| racks | Four fuel cells (`cell-<kind>`) and their hollow targets (`target-<kind>`) |
| cutting | Eight ore tiles (`ore-<kind>`), cut to fill a cell |

`<kind>` is a kit kind's id (`../kit/art.ts`). A kind, charge or grade past its sheet is drawn in
code, as is every board when its atlas does not load.

Additional frames from the sheets (damaged ships, current, thrusters, shield, grapple, flash,
weld, chips, edge, shatter, swipe, ...) are reserved for future effects. Dynamic effects, board
backgrounds and frames (in the same materials, from `../hull.ts`), Engines targets, and
arbitrary-sized Swordfight slabs remain procedural. The atlas is
presentation only; never derive hit areas or gameplay from its pixels. If an atlas fails or times
out, each piece is drawn instead by its vector stand-in in `../parts.ts`, in the same contours and
silhouettes; keep the two in step when a sprite changes shape. Battle's slug sprite points
up; the renderer turns each shot along its line of flight.

Cooling's three specials also have a code-drawn dark chamfered plate, bright double rim and corner
studs, so they stand apart from ordinary objects without relying on color.

## Frames and how the atlas is built

Every frame is one lossless 192×192 WebP, `frames/<puzzle>/<frame>.webp`, and that file is the only
copy of it in the repository (ADR 0054). `frames.json` lists each puzzle's frame names, in the
order the studio's Sprites panel shows them. Art is contained within 176×176 and centered;
Cutting's ore tiles fill the frame instead, cropped inside their source's baked
border so the cells of one piece join without a seam. Overload's frames hold only their largest
piece of art. All of that is in the files: the build treats every frame alike.

No atlas is committed. The Vite plugin `@openseas/boards/vite` (`../../build/`), which the game and
the studio add to their Vite configs, packs each puzzle's frames into one image: rows of four on a
196px stride, each frame inside a 2px transparent gutter, in the list's order, encoded once as WebP
at quality 90 with alpha kept exact. `atlas.ts` imports `virtual:openseas/atlases` for each atlas's
URL and every frame's rectangle. A build emits `<puzzle>-<hash>.webp`; the dev server packs an
atlas when it is first asked for and again when one of its frames changes. Packed atlases are kept
in Vite's cache folder by the hash of their frames. The build refuses a listed frame with no file,
a file no list names, and a frame that is not 192×192. `studio/test/atlases.test.ts` checks that
the built atlas holds every frame file at its rectangle within one encode.

The frames were cut from the committed atlases once (2026-11-15), so each carries the one
quality-90 encode those had, and none is encoded from an earlier encode again. To replace a frame,
write its file; to add one, add its file and its name to the list. Check every board on desktop and
phone with `pnpm --filter @openseas/studio test:smoke`.

The atlas loader caches decoded images and Pixi subtextures for the page lifetime. Renderers own
only their baked canvas textures; do not destroy shared atlas sources during resize/unmount.

## Generating a frame

A frame can be generated alone (ADR 0040). `../../briefs/sprites/<puzzle>.json` describes each
frame and names reference frames for the set's style; `../../scripts/sprites.py gen` draws takes
through the OpenAI Images API into `.art/sprites/`, and `sprites.py place` writes the owner's pick
as the frame's file (a new name is added to `frames.json`). In the studio, Save does the same for a
draft's picks. The `puzzle-sprites` skill walks through it.

## Swapping a frame on a running board

`overrideSprite(puzzle, frame, url)` in `atlas.ts` draws a frame from an image of its own, a whole
192×192 frame, in place of its place in the atlas; `null` puts it back (ADR 0050). Renderers bake
their art once, so whoever holds a board makes it again when `spriteOverrideRevision` moves: the
studio's round frame does. It is how the studio's sprite panel shows another picture on the board.
Nothing is written; that is `sprites.py place`, or the studio's Save.
