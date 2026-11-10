# Puzzle sprites

Original art for OpenSeas. These are raster illustrations, not assets extracted from Puzzle
Pirates. The first set (2026-11-07) was nautical; the owner's sprite pass (2026-11-10) replaced
all seven source sheets with space parts under the same frame names, so the manifest did not
change. Seven approved transparent source sheets are trimmed and packed into the runtime atlases.

## Style and coverage

Painted machine parts and spacecraft, dark navy contours, gentle upper-left lighting, worn paint
and rivets, bold silhouettes readable at 24–48 CSS pixels. No text is baked into sprites. Keep
optional accessibility badges and labels in code.

| Atlas | Runtime use |
|---|---|
| cooling | Cog, valve, bolt, fuse, crystal, coil, chip; charge, magnet and slag plates; vent cloud |
| engines | Trefoil, ring and three-spoke discs and their hollow targets; the extra lab kind stays procedural |
| plating | Tin, copper, steel and brass, brushed horizontally and vertically, composed into exact polyominoes |
| gunnery | Cell, sabot, slug, coolant jug; empty, loaded, jammed and firing turrets; crate |
| navigation | Gold, ice and ember spark/star/comet; hollow target silhouettes |
| swordfight | Four single-cell block and breaker skins, stone and ripening stone |
| battle | Friendly and raider starfighters, asteroids, gravity wells and slugs |

Additional frames from the sheets (damaged ships, current, thrusters, shield, grapple, flash,
weld, chips, edge, shatter, swipe, ...) are reserved for future effects. Dynamic effects, board
backgrounds, Engines targets, and arbitrary-sized Swordfight slabs remain procedural. The atlas is
presentation only; never derive hit areas or gameplay from its pixels. Battle's slug sprite points
up; the renderer turns each shot along its line of flight.

Cooling's three specials also have a code-drawn dark chamfered plate, bright double rim and corner
studs, so they stand apart from ordinary objects without relying on color.

## Packing and replacing

`frames.json` maps names to `[x, y, width, height]` in image pixels. Each frame is 192×192 inside a
196-pixel stride (two transparent pixels on each side); art is contained within 176×176 with its
aspect ratio preserved. Plating material cells instead fill the frame and crop inside the
source's baked border, avoiding per-cell bevels inside one plank.

The generation sheets are not exact uniform grids. `../../scripts/pack-sprites.py` records their
measured column and row edges (midpoints of the transparent gaps between pieces), trims each cell at alpha >32, and resizes with
Lanczos. It writes WebP at quality 90, retaining alpha, plus the named manifest. To repack, install
Pillow in a local Python environment, put the seven source PNG sheets in a directory named
`cooling.png`, `engines.png`, `plating.png`, `gunnery.png`, `navigation.png`, `swordfight.png`,
`battle.png`, then run from the repository root:

```sh
python packages/boards/scripts/pack-sprites.py /path/to/source-sheets
```

If new sheets use different layouts, update their measured source boundaries first. Replace an
atlas and its manifest together. Check every board on desktop and phone with `pnpm test:smoke`.
The atlas loader caches decoded images and Pixi subtextures for the page lifetime. Renderers
own only their baked canvas textures; do not destroy shared atlas sources during resize/unmount.

Optional `overrides/<puzzle>-<frame>.webp` files are complete 192×192 normalized frames. The packer
applies them after processing a source-sheet cell, so repacking cannot restore an obsolete piece.
Atlases with overrides are saved losslessly. There are none at present: the sprite pass drew its
own coolant, so the old bucket override was retired.
