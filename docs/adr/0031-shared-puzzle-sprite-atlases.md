# 0031. Shared puzzle sprite atlases

Status: Accepted. Builds on [0019](./0019-boards-package-and-harness-bench.md).
Supersedes the placeholder-only art choice in DESIGN 3.10; engine rules and authority are unchanged.

## Context

The owner requested generated sprites for all seven puzzles and their integration. The boards
already bake several Canvas 2D painters to Pixi textures, but Carpentry and Navigation retain
Graphics geometry. Each game must still draw exactly the engine's state, stay legible on phones,
and preserve the optional marks, arbitrary polyominoes, growing slabs and lab configurations.

## Decision

- Keep seven compact transparent WebP atlases and named pixel frames in `boards/src/sprites`.
  Vite resolves literal module-relative URLs, fingerprints assets and emits them for both apps.
  A puzzle loads and decodes its atlas once before initializing Pixi. The cache belongs to the
  page; individual renderers never destroy shared atlas textures.
- Reuse the existing Canvas texture bakers for Bilging, Sailing, Gunnery, Swordfight single
  cells and Sea Battle. Carpentry and Navigation use atlas fills within the existing Graphics
  geometry. Gunnery's cannons reuse state sprites and keep their recoil and load indicators.
- Keep hit areas, grid placement, exact footprints, animation, scoring and timing in code. Wood
  cells have no baked edge bevel, so a pentomino still gets one exact procedural outer outline.
  Swordfight slabs retain their existing whole-slab painter; extra lab colors also keep theirs.
- Preserve code-drawn accessibility marks and special labels. Legend icons subscribe to atlas
  readiness and invalidate their canvas URL caches so preview art cannot stay stale.
- Keep procedural painters as a bounded fallback: errors or an eight-second image timeout must
  never prevent play. The harness smoke checks atlas delivery in a production build, resize,
  and playable fallback when images are unavailable, on desktop and phone.

## Consequences

The art can be replaced without engine changes. Backgrounds, dynamic overlays, arbitrary-sized
slabs, target geometry and effects remain procedural. About 1 MB of compressed art is emitted
across all seven atlases; each puzzle requests only its own atlas. Source-sheet packing details,
style guidance and the optional Python/Pillow repacker are documented beside the assets.
