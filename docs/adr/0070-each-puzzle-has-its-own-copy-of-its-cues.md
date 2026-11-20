# 0070. Each puzzle has its own copy of its cues

Status: Accepted. Supersedes the line of [0065](./0065-pieces-and-cues-are-data-the-studio-edits.md)
that keeps every cue in one file for the game and has a revoiced cue heard on every board that
plays it. Builds on [0062](./0062-pieces-are-drawn-in-code-and-cues-stay-synthesized.md) decision 5
and keeps [0064](./0064-stored-sound-picks-and-takes-are-read-and-ignored-and-the-beats-sound-stands-alone.md)'s
beat as it is.

## Context

ADR 0065 made the cues data the studio edits, in one file, `boards/data/cues.json`, because a cue
is played by many boards: `swap` by seven, `clear` by ten. A cue revoiced in one puzzle's studio
was heard on all of them, and the editor said how many. In use the owner tunes one puzzle at a
time, and a change made for Reactor's feel should not move Salvage's. The owner asked for each
puzzle to have its own cues, each editable alone, and chose a full copy for each puzzle over a
shared default with each puzzle's changes laid over it.

## Decision

1. **Each puzzle has a file of its own cues,** `boards/data/cues/<puzzle>.json`: a copy of every
   cue its board and its round play, as `boards/data/cues.json` voiced it when the copies were
   made. A copy is a whole cue, never a change against another.
2. **`boards/data/cues.json` stays the game's own:** the cues played around the boards (the chart,
   a crew, a sheet), and the source a new puzzle copies its cues from.
3. **The puzzle on screen plays its own copies.** The page that shows a board says which puzzle it
   is (`playCuesOf`, or the `usePuzzleCues` hook): the game's duty boards, its fight and its
   melee, and the studio's frame. With none on screen the game's own cues play. A cue a puzzle has
   no copy of plays as the game's.
4. **The beat is the game's alone.** It has one sound, the same on every board (`docs/BRAND.md`
   section 6, ADR 0064), so it is not copied: every puzzle plays the game's beat, the studio's
   Sounds list shows it and does not offer it for revoicing, and a draft that revoices it is
   refused.
5. **The studio revoices a puzzle's own copy, and Save writes it there.** A draft's cues are that
   puzzle's; the editor says so, and Save writes them into `boards/data/cues/<puzzle>.json`.
6. **Every copy is held to the brand book.** The sound tests read every puzzle's copies with the
   game's (copies that are alike are measured once), and a test holds each puzzle's file to the
   cues its board and its round play.

## Alternatives considered

- **A shared default with each puzzle's changes laid over it.** Smaller files and no copy to make
  for a new puzzle; a cue's sound would depend on two files, and a change to the default would
  still move every puzzle that had not changed it. The owner chose copies.
- **Keep one file, and warn louder.** What ADR 0065 did; the change still reached every board.

## Consequences

- A cue changed for the game (in `boards/data/cues.json`) no longer reaches the puzzles: each
  puzzle's copy is changed on its own, deliberately.
- A new puzzle's cues are copied into its own file, and listed in `studio/src/assets/cues.ts` as
  before; `studio/test/cues.test.ts` fails on a file that does not match the list.
- The studio service's Save, the chat agent's note and the pull request's body name the puzzle's
  file. A draft saved before this, with a cue in it, is written to the puzzle's copy.
