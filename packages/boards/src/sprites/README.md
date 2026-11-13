# Puzzle sprites

Original art for OpenSeas. These are raster illustrations, not assets extracted from Puzzle
Pirates. The first set (2026-11-07) was nautical; the owner's sprite pass (2026-11-10) replaced
all seven source sheets with space parts under the same frame names, so the manifest did not
change. Seven approved transparent source sheets are trimmed and packed into the runtime atlases.

## Style and coverage

Every sheet is painted to the style line in `../../briefs/sprite-style.txt`. No text is baked into
sprites. Keep optional accessibility badges and labels in code.

| Atlas | Runtime use |
|---|---|
| cooling | Cog, valve, bolt, fuse, crystal, coil, chip; charge, magnet and slag plates; vent cloud |
| engines | Trefoil, ring and three-spoke discs and their hollow targets; the extra lab kind stays procedural |
| plating | Tin, copper, steel and brass, brushed horizontally and vertically, composed into exact polyominoes |
| gunnery | Cell, sabot, slug, coolant jug; empty, loaded, jammed and firing turrets; crate |
| navigation | Gold, ice and ember spark/star/comet; hollow target silhouettes |
| swordfight | Four single-cell block and breaker skins, stone and ripening stone |
| battle | Friendly and raider starfighters, asteroids, gravity wells and slugs |

The eight prototype boards (ADR 0037) each have an atlas too, painted through the board kit:

| Atlas | Runtime use |
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

The prototype sheets arrive already cut into frames, with a `frames.json` of their own.
`../../scripts/pack-prototype-sprites.py /path/to/delivery` copies each named frame into its
atlas, renames it to what the renderer asks for, and merges the names into the manifest. It makes
two repairs: Cutting's ore tiles are cut inside their baked border and stretched to fill the
frame, and Overload's frames keep only their largest piece of art, since the fins of the sheet's
lower row reach into the row above.

Optional `overrides/<puzzle>-<frame>.webp` files are complete 192×192 normalized frames. Both
packers apply them after processing a source-sheet cell, so repacking cannot restore an obsolete
piece. `pack-sprites.py` saves an atlas with overrides losslessly.

## Generating a frame

A frame can be generated alone (ADR 0040). `../../briefs/sprites/<puzzle>.json` describes each
frame and names reference frames for the set's style; `../../scripts/sprites.py gen` draws takes
through the OpenAI Images API into `.art/sprites/`, and `sprites.py place` writes the owner's pick
as an override and patches it into the atlas and this manifest. The `puzzle-sprites` skill walks
through it.
