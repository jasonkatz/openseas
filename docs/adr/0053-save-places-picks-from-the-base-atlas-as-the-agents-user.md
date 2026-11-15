# 0053. Save places a draft's picks: frames from the base atlas in one pass, as the agent's user

Status: Accepted. Builds on [0040](./0040-generated-art-and-sound-from-briefs.md),
[0041](./0041-sampled-sounds-over-synthesized-cues.md),
[0046](./0046-save-writes-a-drafts-numbers-to-a-pull-request.md),
[0047](./0047-the-chat-runs-an-agent-the-service-holds-to-the-puzzle.md),
[0049](./0049-save-ends-at-the-draft-pull-request.md),
[0051](./0051-takes-are-kept-in-a-railway-bucket-by-their-hash.md) and
[0052](./0052-a-pick-is-the-drafts-and-a-tester-link-carries-it.md). It is the fourth and last
part of M9's third step, assets, and builds the part of [0042](./0042-the-harness-becomes-the-puzzle-studio.md)
decision 10 still unbuilt: "picked takes placed in the atlas and the sounds folder". It
supersedes the last sentence of ADR 0051 decision 10 (the agent "places a take only when the
owner names one"): in the studio the agent never places, and Save does.

## Context

Since ADR 0052 a pick is the draft's: a take's hash by frame or cue, kept with the numbers and
frozen in a tester link. Save ignored picks. Its tester link carried them; its pull request held
the numbers and the agent's edits, and a draft whose only change was a pick had nothing to save.
Landing a pick meant asking the agent to run `sprites.py place` or `sounds.py place`.

A take is already the form it would be committed in (ADR 0051): a lossless 192px WebP frame, or a
mastered MP3. A sound is placed by copying it. A frame is not: the atlas is a committed image, not
built from sources, and `place` pastes a frame into its slot with Pillow and encodes the whole
atlas again at quality 90, so every placement degrades every other frame a little. Pillow on
bytes from the bucket is also a parser fed by whatever wrote them.

The owner agreed to the shape before part 1 and to each detail below before this part was built.

## Decision

1. **Save places every pick, after the numbers and before the commit.** One commit holds both.
   A number and a pick are put back the same way: the draft's `savedNumbers` already keeps the
   picks the last Save placed, so a pick let go since is put back as the base branch has it.
2. **A frame is placed from the base branch's atlas, in one encode.** Save puts the puzzle's
   atlas back as the base branch has it, puts back the override of each frame it placed before
   and that is no longer picked, then runs `sprites.py put`. That pastes every override of the
   puzzle on the branch, then each picked frame as it is, never fitted again, and encodes the
   atlas once at quality 90. Each picked take is kept as its frame's override byte for byte, so
   the committed override's hash is the take's. With no pick left and no other override on the
   branch, the base's atlas is left as it was, not encoded again, and the pull request stops
   changing it.
3. **What the chat placed by hand stays, through its override.** `place` always writes the
   lossless override beside the atlas, and both packers treat overrides as the source of truth
   (ADR 0040). Pasting the branch's overrides back keeps a frame the agent placed. A pick of the
   same frame wins over it. An edit to the atlas that left no override, a repack for one, is lost
   at the next Save that places a frame; the agent does not repack in the studio.
4. **A sound is a byte copy.** The take goes to `boards/src/sounds/<puzzle>/<cue>.mp3`, as
   `sounds.py place` would have mastered it. A `synth` pick deletes that file. Nothing decodes it.
5. **Pillow runs as the agent's unix user, from the service's own copy of the script.** The
   service writes the picked frames into a folder of its own that the agent's user may read and
   not change, hands the worktree to that user, and runs `python3 -I` on the script in the
   service's image with `--root` naming the worktree, never the worktree's copy, which the agent
   can edit. Off production, where the service is not root, it runs as the service's user, as the
   chat does. In production without the agent's user it places no frame and says so.
6. **Every pick is checked before a file is touched, and a pick Save cannot place refuses the
   whole Save.** A hash with no take, a take of the other kind, of another puzzle, or of another
   frame or cue, and a frame the puzzle's manifest does not name are all `pick`, with the frame
   or cue named (`detail`, beside `error` in the draft's Save). A new frame is a change to code:
   only a renderer that asks for it draws it, so Save does not grow an atlas for one. A take the
   bucket cannot give back, a service with no bucket, or a script that fails is `takes`. Either
   way what the Save had written is put back, so the chat's next turn does not commit half of it.
7. **A draft has something to save when it changes a number, picks a take or the chat committed
   an edit.** The service needs nothing new for it: placing a pick makes a commit, and a branch
   with nothing ahead of the base is still `nothing`. The page offers Save for a pick alone.
8. **The pull request says what was picked and what that leaves.** A draft that places picks and
   carries no edit of the agent's is titled as a tuning of numbers and art. Its body has a table
   of each frame or cue, its take (by its number on the draft, else the start of its hash, linked
   to the take on the service) and the file written or removed. Files Save placed are not listed
   as the agent's. Where a frame changed it says to re-run the guide's capture; where a sound was
   placed it says that the smoke's check of sample delivery (ADR 0041) is still owed.
9. **In the studio the agent never places.** Its prompt and both asset skills say so: the owner
   picks a take in its panel, and Save places it. Out of the studio, `place` is as it was.

## Consequences

- A pick lands with one Save. The owner can put any pick back and Save again, and the pull
  request loses it.
- Each Save that places a frame encodes the atlas once from the base branch, so frames do not
  degrade from Save to Save. A pull request that places one frame still changes the whole atlas
  file, a few kilobytes either way.
- The service now runs a script from `packages/boards/scripts`, so a change there deploys the
  service (`deploy.yml`). The script must be readable by the agent's user in the image.
- When `main` changes the same puzzle's atlas under a saved draft, updating the draft is a binary
  conflict and is refused as one (ADR 0046 decision 8). The next Save after a hand merge rebuilds
  the atlas from the new base anyway.
- The first placed sound is the first sample in the repository. ADR 0041 asked the studio's smoke
  to check sample delivery when that happened; the pull request says it is still owed, and the
  developer who finishes it adds the check.
- A service newer than the site sends two error codes the site does not know until it deploys.
  The two deploy together on merge.
- The service's tests run the real script on the real Cooling atlas in a worktree, and, where
  the test runs as root, as a unix user of its own. No test reaches the bucket or GitHub.

## Alternatives considered

- **Place each pick with `place` on the branch's atlas.** No restore, and every Save would encode
  the atlas again on top of the last encode; a pick put back would leave the other frames worse
  than they shipped.
- **A lossless atlas.** No loss at all, at three times the size on every page that opens a board
  (ADR 0040).
- **Restore the atlas from the base and drop what the chat placed.** Simpler, and it would erase
  the agent's committed work without a word.
- **Write the take where `place` expects a numbered take and run `place`.** It fakes the agent's
  folders and fits an already fitted frame a second time.
- **Run Pillow in the service process.** No user to switch to, and a crafted image would be
  decoded by the process that holds the GitHub App's key.
- **Skip a pick Save cannot place and save the rest.** A pull request would hold less than the
  page and the tester link show, with the gap in a note.
