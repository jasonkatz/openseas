# 0071. The beat is each puzzle's own too

Status: Accepted. Supersedes decision 4 of
[0070](./0070-each-puzzle-has-its-own-copy-of-its-cues.md) (the beat is the game's alone), and the
line of `docs/BRAND.md` section 6 that the beat's sound is the same on every board. The beat still
sounds alone, with no cue of its moment laid over it
([0064](./0064-stored-sound-picks-and-takes-are-read-and-ignored-and-the-beats-sound-stands-alone.md)),
and its pulse is still the same on every board.

## Context

ADR 0070 gave each puzzle its own copy of its cues but kept the beat the game's, because the
brand book held its sound the same on every board. The owner asked for the beat to be each
puzzle's as well: a puzzle's big moment should be tunable with the rest of its sound.

## Decision

1. **Each puzzle has its own copy of the beat,** in `boards/data/cues/<puzzle>.json` beside its
   other cues, copied from the game's as shipped. The game's own beat stays in
   `boards/data/cues.json` for the sounds around the boards.
2. **The studio revoices it like any other cue,** and Save writes it to the puzzle's file.
3. **The brand book's rules for it stand:** low, ringing, no longer than `LIMITS.beat`, and heard
   alone. The sound tests hold every puzzle's copy to them.
4. **The pulse is unchanged:** the same on every board, 420ms of `amber`.

## Alternatives considered

- **Keep the beat the game's (ADR 0070).** One sound for one effect everywhere; the owner wants
  each puzzle's tunable.

## Consequences

- `GAME_ONLY_CUES`, the Sounds list's "the game's" mark and the refusal of a revoiced beat are gone.
- `docs/BRAND.md` sections 6 and 8 say the beat's sound is each puzzle's own copy.
