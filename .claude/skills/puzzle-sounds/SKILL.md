---
name: puzzle-sounds
description: Generate a puzzle's sound effects through the ElevenLabs Sound Effects API and keep the owner's picks. Use when a puzzle needs a new or redone sound, or when writing a sound brief.
---

Sounds are made from a **brief** kept in the repository, and the owner picks every take that
lands (ADR 0040). The script is `packages/boards/scripts/sounds.py`; it needs ffmpeg to place.

The boards do not play these files yet: they play the synthesized cues in
`packages/boards/src/audio.ts`. Playing samples is its own ADR. Say so in your report whenever you
place a sound.

## 1. Brief

Write or extend `packages/boards/briefs/sounds/<puzzle>.json`; `swordfight.json` is the worked
example.

- `cues`: one entry a moment the board sounds, keyed by a short name. A puzzle has a cue for each
  moment the bar's first item asks to be heard: the input landing, a clear, a big move, a mistake,
  the round's start.
- `use`: the moment it plays, in a line.
- `prompt`: the sound itself, in physical words: what makes it, the material, the attack, the tail.
  One sound a cue. Under about 350 characters with the style line.
- `duration`: seconds. Most board cues are 0.3 to 1.5; a cue that plays every move is the short
  end.
- `influence`: 0 to 1, how closely the take follows the prompt. 0.5 to 0.7 for game cues.
- `loop` (optional): true for a seamless loop.
- `style`: the line every cue of the puzzle shares (the setting, dry and close, a single sound).
- Describe the sound in its own words: name no other game, film, franchise or artist (rule 3).

Done when every moment the board sounds has a cue.

## 2. Key

`ELEVENLABS_API_KEY`, from the environment or the repository's untracked `.env`. In a cloud
session, ask for it with `request_credential` (host `api.elevenlabs.io`, header `xi-api-key`, no
prefix) and run the script with `ELEVENLABS_API_KEY=placeholder`: the proxy puts the real key in.

## 3. Generate

```bash
python3 packages/boards/scripts/sounds.py gen <puzzle> [cue ...]
```

Three takes a cue by default (`--takes`), all cues when none are named. Each run costs credit and
adds to the takes already in `.art/sounds/<puzzle>/`, so generate again only the cues the owner
turned down, with the prompt reworded.

## 4. Review

You cannot hear the takes: the owner chooses. Locally they open
`.art/sounds/<puzzle>/review.html`, which plays every take beside its prompt and the sound placed
now. In a cloud session, send them the takes as files, named by cue and take. Report each take's
length and peak from the review page, and flag any far off the brief's duration. Done when the
owner has named a take for every cue, or asked for a reworded prompt.

## 5. Place

```bash
python3 packages/boards/scripts/sounds.py place <puzzle> <cue> <take>
```

This trims the lead-in silence (not on a loop), downmixes to mono, peaks at -1 dB and writes
`packages/boards/src/sounds/<puzzle>/<cue>.mp3`. Commit the brief and the placed files together.
