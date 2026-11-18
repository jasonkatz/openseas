# 0064. Stored sound picks and takes are kept, read and ignored, and the beat's sound stands alone

Status: Accepted. Builds on [0062](./0062-pieces-are-drawn-in-code-and-cues-stay-synthesized.md)
decision 5 and on [0063](./0063-stored-sprite-picks-and-takes-are-read-and-ignored.md), whose
approach it extends from sprites to sounds. It supersedes the sentence of 0063 that says
[0051](./0051-takes-are-kept-in-a-railway-bucket-by-their-hash.md) and
[0052](./0052-a-pick-is-the-drafts-and-a-tester-link-carries-it.md) "still stand for sounds":
after M10's sixth step they stand for nothing but reading a kept take by its hash.

## Context

ADR 0062 decision 5 removes the sample pipeline at M10's sound pass, and that step did. As with
sprites one step earlier, the studio's service still holds what the pipeline made: drafts and
tester links whose numbers carry `picks.sounds` (a take's hash, or `synth`), takes of kind `sound`
in the table and the bucket, drafts whose last Save failed with `pick` or `takes`, and `/play`
addresses with `sound.<cue>=<hash>`. ADR 0063 settled the same question for sprites and left
sounds standing. With both gone nothing makes, lists, picks or places a take at all, which opens
two things 0063 did not have to say: what becomes of the `picks` key itself, and of the bucket.

The same step gives the beat (`docs/BRAND.md` section 6) its one sound. Boards and their pages
already played cues at the moments that are now the beat: a fanfare for a streak, a sting for a
callout, the clear itself.

## Decision

1. **Nothing stored is deleted or rewritten.** As ADR 0063 decision 1: no migration, and the
   database's shape does not change. The `take` table, the bucket's objects, the `picks` in stored
   numbers and the columns that name a failed pick all stay.
2. **A draft's `picks` are read and dropped, whole.** `DraftNumbersSchema` names no `picks` key,
   so a draft or a link that carries one parses without it, whatever is in it: nothing of a pick
   is checked, so nothing of one can refuse a draft. `PicksSchema`, `picksOf` and `pickCount` are
   gone. The schema is never made strict; a test in `protocol` holds it to that.
3. **Nothing writes a pick.** The page keeps none in a draft, a link or an address. The service
   strips `picks` from what it sends and from what a new tester link freezes, and a save of a
   draft stores what was sent, which has none. A stored row keeps its `picks` until its draft is
   next saved.
4. **An address with `sound.<cue>=<hash>` still opens,** read past like `sprite.<frame>=<hash>`.
5. **A kept take, of either kind, is still served by its hash and nothing else is done with
   one.** `GET /takes/:hash` stays. The list route, the scan of a worktree, the write to the
   bucket and Save's placing of picks are removed. The bucket is read-only to the service, and its
   variables are needed only to serve what it already holds.
6. **`pick` and `takes` stay in the list of Save's errors,** as `sprite` stays in the kinds of
   take: only read, so a draft whose last Save failed that way still loads and says so.
7. **The chat's reach to the image and sound APIs is unchanged** (ADR 0062 decision 6, ADR 0059).
   No path existed only to make sound takes but the script, its skill and the service's scan.
   `python3` and `ffmpeg`, which only the script needed, leave the service's image.
8. **The beat's sound stands alone.** It is asked for by the beat itself (the kit's `fx.beat`,
   each game board's `beat()`), and `boards/src/audio.ts` drops every other cue asked for in the
   same turn of the page's code, before the beat or after it. Two beats in one moment are one,
   the stronger, and a beat still ringing falls away under the next. Where a cue was played only
   for the event that is the beat, its call is removed as well.

## Consequences

An old draft, link or bookmarked address keeps working, on the board as it now sounds. Stray
`picks` and unlisted takes stay in storage until a later cleanup, which is a migration of its own.
A draft branch on which an earlier Save placed a sample keeps that file: nothing plays it, and
whoever finishes the pull request deletes it. A cue that carries information (the heat alarm)
is not heard if it falls in the same moment as a beat; its picture still shows. A board cannot
play a sound over its beat by mistake, and cannot do so on purpose either.

## Alternatives considered

- **Keep `picks` in the schema as an empty object.** It keeps a word for nothing, and a stored map
  that no longer passed its check would make its draft unreadable.
- **Delete the take routes and the bucket's client outright.** It breaks any address that still
  names a take, and the owner's library would be unreachable without the service being changed
  back. Reading is cheap to keep.
- **Silence layered cues at each call site.** The conditions for a beat live in a board's
  renderer, and the cues in its page and again in the game: two or three copies that drift. One
  rule in the player cannot drift, and a test holds it.
