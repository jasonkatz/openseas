# 0041. A board plays its puzzle's picked samples, with the synthesized cues as the fallback

Status: Accepted. Builds on [0040](./0040-generated-art-and-sound-from-briefs.md) and
[0019](./0019-boards-package-and-harness-bench.md). Supersedes the last sentence of 0040's
decision 5.

## Context

ADR 0040 keeps the owner's picked sounds in `boards/src/sounds/<puzzle>/<cue>.mp3` but left them
unplayed. Every board already speaks through `sfx` in `boards/src/audio.ts`: generic cues (`clear`,
`pop`, `thud`) synthesized in WebAudio and shared by every puzzle, some pitched by an argument (a
cascade climbs a ladder). Swordfighting played nothing. The owner chose to keep the synthesized
cues as the fallback.

## Decision

1. **A sample is a puzzle's voice for a cue.** `sounds/<puzzle>/<cue>.mp3` is bundled by Vite
   (`import.meta.glob`), so both applications fingerprint and serve it. A sample named for an `sfx`
   cue plays in its place on that puzzle's board only; Cooling's `clear.mp3` never sounds on
   Plating. A cue only one puzzle has is played as `sfx.cue(name, fallback)`, and its fallback is a
   synthesized cue.
2. **The open board picks the bank.** Every renderer, and the prototype kit, calls
   `soundsFor(puzzle)` when it is made and releases it when it is destroyed. The latest open board's
   samples are the ones that play.
3. **The synthesized cue always stands behind.** It plays while the samples load, when one fails
   to fetch or decode, and for every cue no sample was made for. A board never waits on a sound.
4. **Decoded once, offline.** A puzzle's samples are fetched and decoded the first time its board
   opens, in an `OfflineAudioContext`, so decoding needs no touch from the player; the page keeps
   them. Mute silences samples as it does the synthesized cues.
5. **An argument still pitches.** A cue pitched by its argument (`clear` by chain, `pop` by step,
   `ping` by distance) plays its sample at the same ratio, so a cascade still climbs.
6. **One gain for every sample.** Samples are placed peaking at -1 dB, less the brief's `level`,
   and played at one gain that sits them with the synthesized cues. A cue's place in the mix is
   set in its brief, not in code.
7. **Swordfighting sounds as it shows:** `drop` when a pair lands, `clash` for a break and `heavy`
   for a chain or a big shatter (pitched up a whole tone a chain step), `swing` as scrap is sent,
   `scrap` as it lands, `out`, `won` and `lost`, each over a synthesized fallback.

## Consequences

Each puzzle adds its own sound files to the build, a few kilobytes a cue, fetched only when its
board opens. The synthesized cues are not retired: they are the fallback, and they are what plays
until a puzzle's sounds are picked. With no sample files in the repository yet, the harness smoke
cannot check sample delivery; it should, as `sprites.spec.ts` does for atlases, once the first
puzzle's sounds land.

## Alternatives considered

- **Replace the synthesized cues outright.** The owner chose to keep them, and a failed fetch
  would leave a board silent.
- **Pass the puzzle to every `sfx` call.** Over a hundred call sites would change for what the
  board's lifetime already says.
- **Decode in the live `AudioContext`.** It cannot start before the player's first touch on some
  browsers, so the first sounds would be synthesized for no reason.
