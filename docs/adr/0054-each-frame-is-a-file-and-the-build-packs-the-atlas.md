# 0054. Each frame is a file of its own, and the build packs every puzzle's atlas

Status: Accepted. Builds on [0031](./0031-shared-puzzle-sprite-atlases.md),
[0037](./0037-prototype-sprite-atlases.md),
[0040](./0040-generated-art-and-sound-from-briefs.md),
[0050](./0050-a-frame-or-a-cue-can-be-swapped-on-a-running-board.md) and
[0053](./0053-a-picked-frame-ships-as-its-own-image-and-save-places-picks.md). It is the step
ADR 0053's Consequences and last alternative leave for later. It supersedes:
- ADR 0053 decision 1. A placed frame no longer ships as an image drawn over the atlas: it is the
  frame's file, and the build packs it into the atlas.
- ADR 0053 decision 2's "the packers still bake overrides into the atlas on a repack". The
  packers are gone.
- ADR 0053 decision 3's "a frame's take is written as its override". It is written as the frame's
  file.
- ADR 0053 decision 10. With no overrides there is nothing of theirs for the smoke to check;
  a unit test checks the built atlas against every frame file.

[0062](./0062-pieces-are-drawn-in-code-and-cues-stay-synthesized.md) superseded this ADR at M10's fifth step: there are no frame files, and the build packs no atlas.

## Context

Each puzzle's atlas was a committed WebP at quality 90, with `frames.json` giving each frame's
rectangle. Nothing built them: the packers made them once from source sheets that are not in the
repository, and the owner no longer has them. ADR 0053 made placing a frame a file write, an
override drawn over the atlas, so no frame wore from another being placed. That left two copies of
a placed frame's place in the game (the atlas's and the override), a second image fetched per
placed frame, and an overlay in `atlas.ts` that every board went through.

## Decision

1. **One lossless 192px WebP a frame is the source of truth:**
   `packages/boards/src/sprites/frames/<puzzle>/<frame>.webp`. No atlas is committed.
2. **`frames.json` lists each puzzle's frame names, in order, and nothing else.** It is kept by
   hand: its order is the order the studio's Sprites panel lists them, and it is the list Save
   checks a pick against (a new frame is still a change to code). The build refuses a listed frame
   with no file, a file no list names, and a frame that is not 192×192.
3. **A Vite plugin in `boards` packs each atlas at build time** (`@openseas/boards/vite`, plain
   JavaScript in `boards/build/` with `sharp`, so any Node 22 loads it from a Vite config). The
   game and the studio add it; the guides capture through the studio. It provides
   `virtual:openseas/atlases`: each puzzle's atlas URL and every frame's rectangle. A build emits
   each atlas as an asset of its own, `<puzzle>-<hash>.webp`; the dev server packs one when it is
   first asked for and again when one of its frames changes. A packed atlas is kept in Vite's
   cache folder by the hash of its frames, so a frame change costs one encode of one atlas.
   Nothing is written into any app's source or public folder.
4. **The layout:** rows of four frames on a 196px stride, each frame with a 2px transparent gutter,
   in the list's order. Frames that fill their cell (Plating's materials, Cutting's ore) keep
   the gutter, so the lossy encode cannot bleed one into the next.
5. **The encode:** WebP quality 90 (ADR 0040), alpha kept exact, effort 5. Effort 6 took about nine
   seconds an atlas against a fifth of a second, for some 2% fewer bytes.
6. **The overlay goes.** `atlas.ts` loads one image a puzzle and draws every frame from it. The
   studio's swap (ADR 0050) stays as the way a pick is previewed.
7. **Placing a frame writes its file and nothing else.** `sprites.py place` writes it (and appends
   a new name to the puzzle's list). Save writes a pick's take, byte for byte, to the frame's file;
   a pick let go puts back the base branch's file. Nothing is decoded on the service. The pull
   request's table names the frame's file.
8. **The one-time split.** The fifteen committed atlases were cut into their 152 frames and each
   saved losslessly. Every frame carries the one quality-90 encode its atlas had; from here on
   each is encoded once a build, from lossless pixels, and never from an earlier encode. No
   overrides were committed, so none was folded in. Both packers are deleted.
9. **A unit test packs every atlas** (`studio/test/atlases.test.ts`) and checks that each frame
   file is at its rectangle with alpha exact and colour within one encode (PSNR above 30 dB,
   premultiplied), and that nothing opaque lies outside a frame.

## Consequences

- A pick is one changed file in a pull request, and two drafts conflict only when they place the
  same frame. No frame wears from another being placed, and none is drawn twice.
- The game fetches one image a puzzle again. The fifteen built atlases come to 1.76 MB against
  the committed 1.78 MB; the repository grows by about 3.4 MB (5.20 MB of frames in, 1.78 MB of
  atlases out), and each placed frame after that is some tens of kilobytes.
- Every app that bundles `boards` adds the plugin, and `sharp` (a prebuilt binary per platform,
  fetched by `pnpm install`) is a development dependency of `boards`. Builds run in CI before
  Vercel sees them (`docs/DEPLOY.md`), so Vercel itself needs nothing. A cold build packs fifteen
  atlases in about a second.
- The atlases shipped from this change are a second encode of what the first one left: the
  frames match them within one encode, and alpha is exact. The guides' pictures were captured
  again for one core puzzle and one prototype to confirm it.
- A new puzzle's atlas is its folder of frames and its list in `frames.json`; `atlas.ts` needs no
  line for it.

## Alternatives considered

- **A prebuild script whose output is gitignored.** Python and Pillow on every CI job and every
  developer's machine, and a fresh checkout that does not typecheck until it has run.
- **A committed atlas regenerated by a script, with CI failing when it is stale.** Deploys stay as
  they are, but Save would have to run the packer again, which ADR 0053 got rid of, or every
  draft would be red until a developer repacked; and binary conflicts come back.
- **A WebAssembly encoder in place of `sharp`.** No native binary, at several times the time.
- **Keep the overrides as well.** Two ways for a frame to reach the board, for nothing.
