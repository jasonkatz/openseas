# Puzzle sprites

Original art generated for OpenSeas on 2026-11-07, using the built-in image generator. These
are raster illustrations, not assets extracted from Puzzle Pirates. Seven approved transparent
source sheets were trimmed and packed into the runtime atlases here.

## Style and coverage

Painted nautical objects, dark navy contours, gentle upper-left lighting, restrained texture,
bold silhouettes readable at 24–48 CSS pixels. No text is baked into sprites. Keep optional
accessibility badges and labels in code.

| Atlas | Runtime use |
|---|---|
| bilging | Seven ordinary objects, keg, ink cloud, barnacles |
| sailing | Canvas, rope and sea discs; the extra salt lab kind stays procedural |
| carpentry | Four woods in horizontal and vertical grain, composed into exact polyominoes |
| gunnery | Powder, wad, shot, water; clean, loaded, fouled and firing cannons; crates |
| navigation | Gold, ice and ember spark/star/comet; hollow target silhouettes |
| swordfight | Four single-cell block and breaker skins, stone and ripening wrack |
| battle | Friendly and brigand sloops, reefs, eddies and cannonballs |

Additional frames from the generated sheets are reserved for future effects. Dynamic effects,
board backgrounds, Sailing targets, and arbitrary-sized Swordfight slabs remain procedural.
The atlas is presentation only; never derive hit areas or gameplay from its pixels.

## Packing and replacing

`frames.json` maps names to `[x, y, width, height]` in image pixels. Each frame is 192×192 inside a
196-pixel stride (two transparent pixels on each side); art is contained within 176×176 with its
aspect ratio preserved. Carpentry material cells instead fill the frame and crop inside the
source's baked border, avoiding per-cell bevels inside one plank.

The generation sheets are not exact uniform grids. `../../scripts/pack-sprites.py` records their
column counts and measured row boundaries, trims each cell at alpha >32, and resizes with
Lanczos. It writes WebP at quality 90, retaining alpha, plus the named manifest. To repack, install
Pillow in a local Python environment, put the seven source PNG sheets in a directory named
`bilging.png`, `sailing.png`, `carpentry.png`, `gunnery.png`, `navigation.png`, `swordfight.png`,
`battle.png`, then run from the repository root:

```sh
python packages/boards/scripts/pack-sprites.py /path/to/source-sheets
```

If new sheets use different layouts, update their measured source boundaries first. Replace an
atlas and its manifest together. Check every board on desktop and phone with `pnpm test:smoke`.
The atlas loader caches decoded images and Pixi subtextures for the page lifetime. Renderers
own only their baked canvas textures; do not destroy shared atlas sources during resize/unmount.
