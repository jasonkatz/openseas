# 0051. Takes are kept in a Railway bucket under their hash, in the form they would be committed in

Status: Accepted. Builds on [0040](./0040-generated-art-and-sound-from-briefs.md),
[0047](./0047-the-chat-runs-an-agent-the-service-holds-to-the-puzzle.md) and
[0050](./0050-a-frame-or-a-cue-can-be-swapped-on-a-running-board.md). It is the second part of
M9's third step, assets. It supersedes the words "an S3 bucket" in
[0042](./0042-the-harness-becomes-the-puzzle-studio.md) decision 12: the bucket is Railway's own,
which speaks S3 and is private. Picks, and Save's placing of them, are the two parts that follow.

[0062](./0062-pieces-are-drawn-in-code-and-cues-stay-synthesized.md) superseded all of it at M10's sixth step but the reading of a kept take by its hash: no take is made, kept or listed, and [0064](./0064-stored-sound-picks-and-takes-are-read-and-ignored-and-the-beats-sound-stands-alone.md) says what becomes of those the bucket holds.

## Context

ADR 0042 decision 12 says every generated take goes to object storage under its content hash and
is kept across drafts, so a frame or a cue gathers a library and a tester link can load a pick.
ADR 0040 says how a take is made: the two scripts in `boards/scripts`, from a brief, into a
gitignored `.art/` folder, and placed by the same scripts once the owner has picked.

The owner settled these before it was built:

- **The bucket is a Railway bucket**, in the studio's project, not one at another provider.
  Railway's buckets are private: there is no public read, and a bucket has one credential that
  reads and writes.
- **A take is read through the service, and every take is readable by its hash.** Listing takes
  is the owner's.
- **The service uploads, not the agent.** The bucket's credentials stay out of the agent's shell.
- **Each take is counted against the cap at an estimate.** The scripts pay for takes with the two
  keys in the agent's shell (ADR 0047 decision 2), so the service never sees the bill.

Two things were found on the way. The service's image had no Python, no Pillow and no ffmpeg, so
the scripts could not have run there at all. And a take as the generator returns it is not what a
board draws or plays: a sprite is a 1024-pixel picture that `place` trims and fits to a frame, a
sound is trimmed, made mono and levelled.

## Decision

1. **A take is kept in the form it would be committed in.** `sprites.py gen` writes, beside each
   `take-<n>.png`, the fitted 192-pixel frame `frame-<n>.webp`, lossless, exactly what `place`
   writes as the override. `sounds.py gen` writes, beside each `take-<n>.mp3`, the mastered
   `placed-<n>.mp3`, exactly what `place` keeps, with no encoder tag so the same take masters to
   the same bytes. Each has a subcommand that does only this (`frames`, `placed`). So a take seen
   or heard on a board in the studio is, byte for byte, what placing it commits, and its hash is
   the hash of what would be committed. The raw take stays in the worktree and is not kept.
2. **The service keeps a turn's takes when the turn ends.** It reads the draft's worktree for the
   open puzzle's frames and placed sounds, and for each one it has not kept: puts the bytes in the
   bucket at `takes/<sha256>` and writes a row (the hash, sprite or sound, the puzzle, the frame
   or cue, the size, the words the generator was given, the draft and the take's number on it,
   the owner). The bytes go first, so a row always has its take behind it. A take is kept once.
3. **The agent's files are read as another user's.** They are written by commands the service
   did not choose, and the service may be root. A link is never followed, a folder must be a
   folder, a name must be what a script writes, a file must be plain and under a size, and where
   the machine can say where an open file really is it must be under the worktree's `.art/`. A
   picture must say in its first bytes that it is a WebP of one frame's size, a sound that it is
   an MP3; neither is decoded by the service. How a take is served is the service's to say: a
   sprite as `image/webp`, a sound as `audio/mpeg`, never sniffed.
4. **A take is kept when its draft is gone.** The row names its draft and does not belong to it.
   Discarding a draft, or its pull request merging, removes no take.
5. **Anyone with a take's hash may read it; only the owner may list.** `GET /takes/<hash>` answers
   any origin with the bytes, to be kept for good by whoever asked: a hash never names other
   bytes, and nobody can guess one. `GET /takes?puzzle=` is the signed-in owner's. A tester link
   will carry a pick as a hash and read it this way, which is where `/play` comes to ask the
   service for more than the link.
6. **The bucket is reached by signed requests from the service alone.** Four variables name it
   (`STUDIO_BUCKET_ENDPOINT`, `STUDIO_BUCKET_NAME` and the two keys). Short of any, the service
   keeps no takes and says so (`takes: false`), the chat still makes them in the worktree, and
   the panels list none. A failing bucket is asked three times, not ten.
7. **The meter counts a take at an estimate.** When a turn's takes are kept, each new one adds a
   fixed sum to the turn's cost, the draft's and the one meter all drafts share (`takes/takes.ts`:
   a sprite about what a high-quality image with references costs, a sound a few cents). It is
   counted after the money is spent, so a turn is not stopped by it; the next turn is, at the
   cap. Capping generation before it is paid for means the scripts reaching their APIs through
   the service, as the model is reached, which is not built.
8. **The panels list a frame's or a cue's takes in its row.** For the signed-in owner of a
   service that keeps takes. A take made on the open draft is named by the number the script gave
   it (`take 3`), which is how the agent names it too; any other by the start of its hash. A tap
   puts a take on the running board through the swap (ADR 0050), as a tried file is: on that page
   only, until picks are built. The panels ask again when a turn ends.
9. **A row writes the start of a message.** Where there is a chat, each row ends with "New
   takes" and "Change this", which put the opening words in the chat's box for the owner to
   finish.
10. **The agent is told how takes reach the owner.** It cannot send files: the studio lists a
    turn's takes when the turn ends. It makes them, says which it would shortlist, and stops. It
    places a take only when the owner names one, as the skills have always said; Save placing
    picks replaces that in the part after next.
11. **The image carries what the scripts need.** `railpack.studio.json` adds `python3`,
    `python3-pil` and `ffmpeg`.

## Consequences

- There is a bucket to create and four variables to set (`docs/DEPLOY.md`, step 1b). Storage is
  a few kilobytes a take; reading goes through the service, which is one more thing a tester's
  page will lean on once links hold picks.
- The estimate is not the bill. A take the script made and the scan passed over (a picture with
  nothing in it, a sound when there was no ffmpeg) is paid for and not counted; a turn can spend
  past the cap on takes before the cap is seen. The owner was told, and chose the estimate.
- A sound's `level` is mastered into its take. A take made before the brief's `level` changed
  keeps the old level; new takes are needed to hear the new one.
- The raw takes, the contact sheet and the review page stay in the worktree, on the volume, and
  go when the draft's worktree goes. The library holds only what a board can use.
- `sounds.py place` now writes without an encoder tag. Nothing had been placed yet (ADR 0041), so
  no committed file changes.
- Every take is public to whoever holds its hash, the ones nobody picked included. They are
  generated pictures and sounds of game pieces, made from briefs that are public in the
  repository.
- The service's tests keep takes in memory in the bucket's place, and hold the bucket's client to
  a stand-in that records what it was sent. No test reaches Railway, calls a generator, or runs
  the real agent through a script: the first real take is the owner's to make.

## Alternatives considered

- **A bucket at another provider, with public read by hash.** One fewer hop for a tester's page.
  The owner asked for Railway's, to keep the studio's parts in one place.
- **A presigned URL for each read.** The service would send no bytes itself. A tester link never
  expires and a presigned URL does, so the service would still be asked for each one; and the
  board needs the picture with cross-origin access, which the service's own answer is sure to
  give.
- **Keep the raw take and fit it in the browser.** No change to the scripts. Then what is seen in
  the studio is one program's fitting and what is committed is another's.
- **Let the agent upload.** The script could do it in one step, with the bucket's one read-and-
  write credential in the agent's shell.
- **Proxy the two generation APIs now.** A true cap, and two keys out of the agent's shell. It is
  a second proxy with its own price table; the owner chose the estimate first.
- **Only picked takes readable.** It needs the service to know every pick in every link and
  draft before it will serve, for bytes that are no secret.
