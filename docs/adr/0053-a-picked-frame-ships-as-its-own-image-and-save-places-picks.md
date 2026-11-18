# 0053. A picked frame ships as its own image over the atlas, and Save places a draft's picks as their takes' bytes

Status: Accepted. Builds on [0040](./0040-generated-art-and-sound-from-briefs.md),
[0041](./0041-sampled-sounds-over-synthesized-cues.md),
[0046](./0046-save-writes-a-drafts-numbers-to-a-pull-request.md),
[0049](./0049-save-ends-at-the-draft-pull-request.md),
[0050](./0050-a-frame-or-a-cue-can-be-swapped-on-a-running-board.md),
[0051](./0051-takes-are-kept-in-a-railway-bucket-by-their-hash.md) and
[0052](./0052-a-pick-is-the-drafts-and-a-tester-link-carries-it.md). It is the fourth and last
part of M9's third step, assets, and builds the part of [0042](./0042-the-harness-becomes-the-puzzle-studio.md)
decision 10 still unbuilt: "picked takes placed in the atlas and the sounds folder". It
supersedes two things:
- ADR 0040 decision 4's "and patches it into the atlas and `frames.json`". A placed frame is
  its override alone, which the boards draw over the atlas.
- The last sentence of ADR 0051 decision 10 (the agent "places a take only when the owner names
  one"). In the studio the agent never places, and Save does.

[0062](./0062-pieces-are-drawn-in-code-and-cues-stay-synthesized.md) superseded its sprite parts at M10's fifth step: Save places no frame; it still stands for a sound's pick.

[0062](./0062-pieces-are-drawn-in-code-and-cues-stay-synthesized.md) superseded its sound parts too at M10's sixth step: Save places no pick of any kind ([0064](./0064-stored-sound-picks-and-takes-are-read-and-ignored-and-the-beats-sound-stands-alone.md)).

## Context

Since ADR 0052 a pick is the draft's: a take's hash by frame or cue, kept with the numbers and
frozen in a tester link. Save ignored picks, and a draft whose only change was a pick had nothing
to save.

A take is already the form it would be committed in (ADR 0051): a lossless 192px WebP frame, or a
mastered MP3. A sound is placed by copying it. A frame was not: the atlas is a committed image,
and `place` pasted a frame into it with Pillow and encoded the whole atlas again at quality 90,
so every placement wore down every other frame a little. Placing picks that way on the service
would have meant restoring the atlas from the base branch on each Save, decoding bucket bytes
with Pillow under a unix user of its own, and a binary conflict whenever `main` touched the same
atlas. A first version of this part was built that way and replaced before merging.

The boards could already draw a frame from an image of its own (ADR 0050); that is how the
studio shows a pick. Every placed frame already had one, its override.

## Decision

1. **A placed frame ships as its own image.** `boards/src/sprites/atlas.ts` bundles every
   `sprites/overrides/<puzzle>-<frame>.webp` and decodes a puzzle's with its atlas, before the
   atlas counts as ready, so a board never draws the old frame first. From then on each is drawn
   in place of the atlas's frame. The studio's swap sits over it, and letting a swap go shows the
   placed frame, not the atlas's. One that fails to load leaves the atlas's frame. A placed frame
   the atlas lacks is listed with the puzzle's frames and drawn by a renderer that asks for it.
2. **Placing never encodes the atlas.** `sprites.py place` writes the override and nothing else.
   The packers still bake overrides into the atlas on a repack, and drawing the same image over it
   changes nothing.
3. **Save places every pick as its take's bytes, after the numbers and before the commit.** A
   frame's take is written as its override, a sound's into `boards/src/sounds/<puzzle>/<cue>.mp3`,
   and a `synth` pick deletes that file. Nothing is decoded, so no unix user and no Pillow are
   involved. A take on a board in the studio is byte for byte what the pull request commits.
4. **A pick let go is put back as a number is.** The draft's `savedNumbers` already keeps the
   picks the last Save placed. A file one of them wrote that the draft no longer picks goes back
   to what the base branch has there, or away.
5. **What the chat placed by hand is left alone.** Save writes only the files of the frames and
   cues the draft picks or let go. A pick of a frame the agent placed wins over the agent's.
6. **Every pick is checked before a file is touched, and a pick Save cannot place refuses the
   whole Save.** Each of these is `pick`, with the frame or cue named (`detail`, beside `error`
   in the draft's Save):
   - a hash with no take;
   - a take of the other kind, of another puzzle, or of another frame or cue;
   - a take whose first bytes are not a frame or an MP3;
   - a frame the puzzle's manifest does not name. A new frame is a change to code.

   A take the bucket cannot give back, or a service with no bucket, is `takes`. Either way what
   the Save had written is put back, so the chat's next turn does not commit half of it.
7. **A draft has something to save when it changes a number, picks a take or the chat committed
   an edit.** Placing a pick makes a commit, and a branch with nothing ahead of the base is still
   `nothing`. The page offers Save for a pick alone.
8. **The pull request says what was picked and what that leaves.** A draft that places picks and
   carries no edit of the agent's is titled as a tuning of numbers and art. Its body has a table:
   each frame or cue, its take (by its number on the draft, else the start of its hash, linked to
   the take on the service), and the file written or removed. Files Save placed are not listed as
   the agent's. Where a frame changed it says to re-run the guide's capture. Where a sound was
   placed it says that the smoke's check of sample delivery (ADR 0041) is still owed.
9. **In the studio the agent never places.** Its prompt and both asset skills say so: the owner
   picks a take in its panel, and Save places it. Out of the studio, `place` writes an override.
10. **The smoke checks every placed frame.** For each override committed, the studio's Sprites
    panel must draw that frame from its own file, delivered and decoded. With none committed there
    is nothing to check.

## Consequences

- A pick lands with one Save, and can be put back with another.
- A puzzle with placed frames fetches one more small image for each when its board first opens,
  and draws those frames from textures of their own. A frame is a few to some tens of kilobytes.
- The atlases stop changing when frames are placed, so no frame wears and two drafts conflict
  only when they place the same frame.
- If placed frames pile up, building the atlas from per-frame sources at build time is the next
  step: one file a frame in the repository, one image a puzzle in the game. The overrides are
  already those per-frame files.
- The first placed sound is the first sample in the repository. ADR 0041 asked the studio's smoke
  to check sample delivery when that happened; the pull request says it is still owed.
- A service newer than the site sends two error codes the site does not know until it deploys.
  The two deploy together on merge.

## Alternatives considered

- **Restore the atlas from the base branch and paste every pick in one encode.** It was built
  first. No wear from Save to Save, but Pillow on bucket bytes under the agent's user, a script
  the service had to run, and a binary conflict on every atlas two branches touched.
- **Paste each pick into the branch's atlas with `place`.** Every Save would encode the atlas on
  top of the last encode.
- **A lossless atlas.** No wear, at three times the size on every page that opens a board
  (ADR 0040).
- **Build atlases from per-frame sources at build time.** The best of both, at the cost of a
  build step for both front ends and the guides' capture, and splitting fifteen atlases into
  files. It is left for when placed frames are many.
