# 0062. Pieces are drawn in code and cues stay synthesized: the generated sprites and sounds retire

Status: Accepted. Builds on [0061](./0061-the-game-looks-lo-fi-and-minimalist-by-a-brand-book.md).
It supersedes, puzzle by puzzle as M10 restyles each, the sprite decisions of
[0040](./0040-generated-art-and-sound-from-briefs.md) and with them
[0031](./0031-shared-puzzle-sprite-atlases.md), [0037](./0037-prototype-sprite-atlases.md),
[0053](./0053-a-picked-frame-ships-as-its-own-image-and-save-places-picks.md) and
[0054](./0054-each-frame-is-a-file-and-the-build-packs-the-atlas.md). At M10's sound pass it
supersedes [0041](./0041-sampled-sounds-over-synthesized-cues.md) and the sound decisions of 0040.
Until a puzzle is restyled, those ADRs still describe it.

## Context

Pieces are generated painted images: 157 frame files across 15 puzzles, made from briefs through
an image API, picked by the owner and packed into atlases by the build. Under every one sits a
code-drawn fallback (`boards/src/parts.ts`, `boards/src/kit/art.ts`). Sounds were to go the same
way, generated samples over synthesized cues, but no sample has been picked: all 27 cues play
their synthesized voice.

ADR 0061 makes the look flat vector on one palette. That is what code draws best and what an image
model draws worst: generated flat art drifts in colour, edge and stroke weight from frame to
frame, and that drift is what makes minimalism look cheap. The same holds for 27 cues that should
sit in one key.

## Decision

1. **A piece is drawn in code,** from the palette's tokens, by the rules in `docs/BRAND.md`
   section 3. A restyled puzzle loads no atlas.
2. **A puzzle's frames are deleted in the PR that restyles it.** Its entry in `frames.json`, its
   sprite brief and its place in the atlas test go with them. A puzzle not yet restyled keeps its
   frames, and the build keeps packing them.
3. **The sprite tooling is removed when the last puzzle is restyled,** in one PR: the atlas
   plugin, `scripts/sprites.py`, `briefs/sprite-style.txt`, the `puzzle-sprites` skill, the
   studio's sprite panel, takes and picks of frames, and the "own sprites" half of item 23 of the
   `puzzles` skill. Not before: a half-converted game still needs all of it.
4. **A puzzle still has pieces of its own.** What a puzzle owns is its pictograms, drawn in its
   own file beside its renderer. The shared part is the palette and the drawing rules.
5. **Cues stay synthesized and are retuned,** by `docs/BRAND.md` section 8, at M10's last step.
   The sample pipeline (`scripts/sounds.py`, the sound briefs, the `puzzle-sounds` skill, the
   studio's sound takes and picks, and sample playback in `boards/src/audio.ts`) is removed in
   that step's PR. The studio's list of a puzzle's cues stays.
6. **Nothing generated lands in the game after this.** The image and sound APIs stay available to
   the studio's chat for other work; the metering of ADR 0059 is unchanged.

## Consequences

Every piece hits the palette exactly, is sharp at any size and weighs nothing to load. A piece can
be recoloured by changing a token. The studio loses its Assets mode's reason to exist, most of
M9's third step, and the code that serves it is deleted over M10. Drawing 15 puzzles' pictograms
by hand in code is real work, and a pictogram is plainer than a painting: a kind that needed
texture to be told apart now needs a better outline. The owner no longer picks takes; the owner
reviews pieces on the board in a pull request.

## Alternatives considered

- **Keep the pipeline and regenerate every frame flat.** It keeps the studio's tooling in use, and
  it cannot hold a palette or a stroke weight across 157 frames.
- **Author pieces as SVG files and pack those.** It keeps a pipeline for no gain over drawing with
  the same calls the fallbacks already use, and a file cannot read a token.
- **Remove the tooling now.** The unrestyled puzzles would have no pieces.
- **Generated samples for sound.** Twenty-seven separate takes will not sit in one key.
