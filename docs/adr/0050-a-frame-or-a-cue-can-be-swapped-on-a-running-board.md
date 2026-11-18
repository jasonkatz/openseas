# 0050. A frame or a cue can be swapped on a running board, and the studio lists every one

Status: Accepted. Builds on [0042](./0042-the-harness-becomes-the-puzzle-studio.md) decision 12,
on [0031](./0031-shared-puzzle-sprite-atlases.md), [0037](./0037-prototype-sprite-atlases.md) and
[0041](./0041-sampled-sounds-over-synthesized-cues.md). It is the first part of M9's third step,
assets. It supersedes nothing: takes, picks in a draft and Save's placing of them are the parts
that follow, each with its own ADR.

[0062](./0062-pieces-are-drawn-in-code-and-cues-stay-synthesized.md) superseded its sprite parts at M10's fifth step (the frame swap, the sprite panel and the marks toggle in its legend); it still stands for sounds.

[0062](./0062-pieces-are-drawn-in-code-and-cues-stay-synthesized.md) superseded its sound parts too at M10's sixth step (a cue given another voice, a file tried in its place): what stands is the studio's list of a puzzle's cues, each with a button that plays it.

## Context

ADR 0042 decision 12 says `boards` gains a way to swap a frame or a cue on a running board, and
that this is presentation and stays within its rule. DESIGN.md 3.14 says the studio has a sprite
panel listing every frame in a puzzle's atlas and a sound panel listing every cue its board
plays, that sprites show at board size, that sounds play on a tap with the synthesized cue listed
as a pick, and that the sprite panel previews every frame with the marks setting on and off.

Three things about the code as it stood shape how that is done:

- Every renderer bakes its art once, when it is made: tile textures, the kit's painted pieces,
  legend icons. Their caches are keyed on the atlas's revision, so a renderer made after a change
  draws the new art, and one made before it does not.
- A core board's sounds are played by the page around it, not by its renderer, so nothing in
  `boards` knows the list of cues a puzzle plays. A puzzle's own cue (`sfx.cue("clash", ...)`)
  carries its synthesized fallback at the call site.
- A mark is drawn in code on a kind, by each board's own icon. Nothing maps a frame to a mark.

The owner settled the order of the step: this part first, with no change to the service, then
takes in a bucket, then picks in drafts and links, then Save.

## Decision

1. **A frame can be drawn from an image of its own.** `overrideSprite(puzzle, frame, url)` in
   `boards/src/sprites/atlas.ts` loads a whole square frame, as an atlas would hold it, and from
   then on every reader of that frame (`drawSprite`, `spriteTexture`, `spriteCrop`, `hasSprite`)
   gets it in place of the atlas's. `null` puts the atlas's back. The image is asked for with
   cross-origin access, so a take read from another origin can be baked into a texture. An image
   that does not load changes nothing.
2. **A board is made again when a frame is swapped under it.** A swap moves a counter of its own
   (`spriteOverrideRevision`), and whoever holds a board keys it on that counter. The studio's
   round frame does: the board is unmounted and made again on the round as it stands, so the
   round, its score and its clock carry on and only an animation in flight is lost. No renderer
   learns to rebuild its art in place; eight of them bake it in eight ways.
3. **A cue can be given another voice.** `overrideSample(puzzle, cue, voice)` in
   `boards/src/audio.ts` takes a sound's URL, `"synth"` for the synthesized cue though a sample
   is bundled, or `null` for what the build ships. It takes hold the next time the cue plays; no
   board is made again. A sound that does not decode changes nothing.
4. **A cue can be heard with no board open.** `auditionCue(puzzle, cue)` plays what that puzzle's
   board would: the chosen voice, else the bundled sample, else the synthesized cue with a plain
   argument (a first step, a small clear). For a puzzle's own cue the caller names the
   synthesized cues its renderer plays behind it.
5. **None of this computes anything.** The swap changes pixels and samples. Hit areas, marks and
   numerals stay in code (`sprites/README.md`), and nothing reads a score from it (ADR 0019).
6. **The cues a puzzle plays are a list in the studio, held to the source.**
   `studio/src/assets/cues.ts` names each puzzle's cues, the three every round plays, and for a
   puzzle's own cues the synthesized ones behind them. A test reads each board's folder in
   `boards` and its page in the studio and fails when the list and the source disagree.
7. **The side panel has three faces: Tuning, Sprites, Sounds.** All three stay in the page while
   one shows. The sprite panel has a row for every frame in the atlas, at the size a board draws
   it and larger. The sound panel has a row for every cue, played on a tap, with the synthesized
   cue as a pick and the bundled sample as another where the puzzle has one.
8. **Marks on and off are the page's own legend.** The sprite panel shows the legend the puzzle's
   page already draws for its details sheet, with its marks toggle: each kind as the board draws
   it, with the mark and without, and the board beside it follows the same setting. It is not a
   pair of pictures a frame, because a mark belongs to a kind and is drawn by each board's own
   code.
9. **A file can be tried in a row.** Until takes exist, a picture or a sound from the owner's
   machine can be put in a frame's or a cue's place on that page. A picture is trimmed and fitted
   to a frame in the browser as `sprites.py place` would fit it. A sound is played as it is, not
   trimmed or levelled, and the panel says so. A tried file lives in the page: it is not kept,
   not in the draft, not in a link, not saved, and leaving the page puts everything back.

## Consequences

- The panels ask the service nothing and work with it down. `/play` is untouched but for the
  board's key, which never moves there.
- A swap leaves the frame's old texture to whichever board still holds it, and the caches keyed
  on the atlas's revision keep their old entries. On a page where frames are swapped all day
  that is memory not given back until a reload; it is a studio page.
- A board being made again drops what its renderer alone knew: an animation in flight, a held
  drag. The round does not notice.
- A frame the atlas does not hold can be given an image, but only a renderer that asks for that
  name draws it. A new frame is still a change to code.
- The list of cues is one more thing a new cue touches. The test says so when it is forgotten.
- No puzzle has a bundled sample yet (ADR 0041), so today every cue's shipped voice is the
  synthesized one and the sample pick is not seen. The smoke tries a file in a cue's place; it
  cannot hear, and checks only that the sound decoded and the row says so.
- Tried files are not picks. Picks, what a draft and a tester link hold and what Save places,
  come with the takes they choose between.

## Alternatives considered

- **Teach each renderer to rebuild its art in place.** Nothing in flight would be lost. It is
  eight renderers and the kit, each with its own baked textures, for a swap the owner makes a
  few times a session.
- **Deal the round again on the same seed, as a changed number does.** Simpler still, and the
  round would be lost for a change that touches no rule.
- **Find the cues at run time, by listening to what a board plays.** No list to keep, and a row
  would appear only once its cue had sounded.
- **A brief as the list of cues.** It is where a cue is described (ADR 0040), and one puzzle has
  one. The panel would be empty for fourteen.
- **A mark drawn over each frame in the panel.** It needs a table from frame to kind to mark for
  every puzzle, a second copy of what each board's icon already knows.
- **No tried files; wait for takes.** The swap would then have nothing on screen to drive it
  until the bucket exists, and a take made on a developer's machine could not be seen on a board.
