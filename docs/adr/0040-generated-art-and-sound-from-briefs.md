# 0040. Puzzle sprites and sounds are generated from briefs in the repository

Status: Accepted. Builds on [0031](./0031-shared-puzzle-sprite-atlases.md) and
[0037](./0037-prototype-sprite-atlases.md). [0041](./0041-sampled-sounds-over-synthesized-cues.md)
supersedes decision 5's last sentence: the boards play the kept sounds.

## Context

The owner painted every sprite sheet by hand in ChatGPT from a brief an agent wrote in chat, then
cut and delivered the sheets for a packer. The prompts were lost once a sheet landed, so a missing
frame, a new kind or a redraw started again from nothing, and a whole sheet came back for one
frame. Sound has no pipeline at all: the boards play minimal synthesized cues (DESIGN 3.9), and
Swordfighting plays none.

Both the OpenAI Images API and the ElevenLabs Sound Effects API can be scripted, so an agent can
make the takes and the owner only has to choose between them.

## Decision

1. **A brief is a file.** `packages/boards/briefs/sprites/<puzzle>.json` names each frame the
   renderer asks for and describes it, plus the reference frames that hold the set's style;
   `briefs/sprite-style.txt` is the style line every sheet is painted to.
   `briefs/sounds/<puzzle>.json` names each cue, says when it plays, and gives its prompt,
   duration and prompt influence. A brief changes in the same commit as the frames or cues it
   describes.
2. **Scripts make the takes.** `packages/boards/scripts/sprites.py` and `sounds.py` call the two
   APIs with keys from the environment or the untracked `.env` (`OPENAI_API_KEY`,
   `ELEVENLABS_API_KEY`). Takes, each with the exact request beside it, and a review page go to
   `.art/`, which git ignores. A sprite is drawn one frame per image with the atlas's own frames as
   references, so a new frame matches the set without a new sheet.
3. **The owner picks.** Nothing generated lands without the owner choosing the take. An agent may
   shortlist sprites by looking at the contact sheet; it cannot hear, so it never shortlists sounds
   by anything but length and level.
4. **A picked sprite is an override.** `sprites.py place` fits the take to a 192px frame, writes it
   as `sprites/overrides/<puzzle>-<frame>.webp` and patches it into the atlas and `frames.json`. Both
   packers apply overrides, so a repack from the delivered sheets keeps it. The atlas stays at WebP
   quality 90; a lossless one is three times the size.
5. **A picked sound is kept in `boards/src/sounds/<puzzle>/<cue>.mp3`**, trimmed to its first
   sound, mono and peaking at -1 dB. The boards do not play these files yet: playing samples over
   the synthesized cues, with the synthesized ones as the fallback, is its own ADR.
6. **Original, still.** A brief names no other game, film, franchise or artist, and describes what
   the thing is and how it sounds or looks in its own words (rule 3).

## Consequences

A frame or a cue can be redrawn or added alone, from a prompt that is kept. Generation costs API
credit per take, so the scripts make a few takes a run and keep every earlier one. The atlases are
re-encoded on each placement; the lossless overrides are the source of truth for placed frames.
Sound files will sit unplayed until the playback ADR lands.

## Alternatives considered

- **Keep painting whole sheets in ChatGPT.** One frame costs a whole sheet, the prompt is lost, and
  every delivery needs its sheet's boundaries measured.
- **Generate whole sheets through the API.** The same cutting problem, with less control over each
  frame.
- **Commit the takes.** Most are thrown away; only the pick earns a place in the repository.
