# 0046. Save writes a draft's numbers to a branch and a draft pull request, with no agent

Status: Accepted. Builds on [0042](./0042-the-harness-becomes-the-puzzle-studio.md) decisions 4, 9
and 10 and on [0045](./0045-drafts-are-kept-by-the-studio-service.md). It supersedes nothing. It is
the second part of M9's second step: the clone, the worktrees, the volume and the GitHub App,
proven with no model running. The owner chose that order, Save before chat.

## Context

ADR 0042 decision 10 gives Save three stages: a tester link at once; then the overlay written into
the content file, a commit, a push and a draft pull request from the GitHub App; then the agent
working the changed-puzzle checklist and marking the pull request ready. The first stage has
existed since ADR 0043 and the third needs the agent. This is the second, for numbers.

It is also the first time the service holds a clone of the repository and a credential that can
write to it. Building it before the agent means the agent arrives to a clone, a worktree a draft
and a push path that already work and are already tested, and that the only new thing in that
part is the model.

## Decision

1. **The service keeps one clone on a volume, and a worktree and branch for each draft that has
   been saved.** `STUDIO_REPO_DIR` names the directory: `repo/` is the clone, made with no
   checkout, and `worktrees/<draft id>/` is a draft's files on its branch,
   `studio/<puzzle>-<draft id>`, cut from the base branch when the draft is first saved. A draft
   that has never been saved has neither: it is an overlay and nothing more (ADR 0042 decision 2).
   If the volume is lost, the next Save clones again and takes the draft's branch from the
   remote, where its pull request still is.
2. **Save is one request and a job.** `POST /drafts/<id>/save` names the revision on the page,
   which must be the stored one, and a name. The service makes the tester link and answers with
   it at once; the branch is written after, one job at a time, and the page asks how it went.
   Where the draft stands (being written, failed and why, its pull request, which revision that
   holds) is on the draft's row and survives a restart; a Save the process died under is marked
   as interrupted.
3. **The numbers are written where they stand in the content file, and nothing else in it
   moves.** Each override is set at its path in `packages/content/data/puzzles/<puzzle>.json`,
   and `roundSeconds`, `paceSeconds` and `thresholds` beside them, by an edit that replaces the
   one value and draws it as the value it replaces was drawn. The files are laid out by hand, so
   the commit's diff shows the numbers and no reformatting. A key the file has no branch for is
   refused. The seed is not a number of the file's and is not written.
4. **A number put back in the studio is put back in the pull request.** The row keeps the numbers
   the last Save wrote. A key among them that the draft no longer changes goes back to what the
   file held where the branch left the base branch, or out of the file if it was not there.
   Everything else in the file is left as it is, which is what will let the agent, and a hand,
   edit the same file on the same branch.
5. **The pull request comes from the studio's GitHub App and stays a draft.** The App is
   installed on this repository alone with contents and pull requests to write. The service
   signs as the App, asks for an installation token narrowed to this repository and those two
   permissions, and opens the pull request as a draft with the owner named and linked in its
   body, the numbers it changes, and the tester link. Its body says the changed-puzzle checklist
   has not been run. The owner's own GitHub sign-in is still used for nothing but who they are
   (ADR 0043 decision 5).
6. **The App's key and tokens stay in the service process.** A token reaches `git` as a header in
   the environment of the one fetch or push that needs it, for the remote's host alone. It is
   never written to the clone's config or anywhere on the volume, so nothing that later runs in a
   worktree, the agent included, finds a credential that can push.
7. **A later Save adds commits to the same pull request, until it is merged or closed; then the
   draft clears.** When the owner's drafts are listed the service asks GitHub, at most twice a
   minute a draft, what became of each pull request. Merged or closed, the draft's row, worktree
   and local branch go, and the puzzle is back on the shipped numbers. Discarding a draft closes
   its pull request and deletes its branch on the remote, and the confirmation says so.
8. **When the base branch has moved the studio says so, and merges it only when asked.** A
   listing also says whether a saved draft's branch is behind the base branch. The owner's
   "update" merges the base branch into the draft's and pushes. It is a merge: the draft's
   commits are never rewritten, and nothing is merged unasked. Where the two changed the same
   lines the merge is abandoned, the branch is left as it was, and the page says so.
9. **Without the volume, the repository or the App, the service says it cannot Save.** The four
   variables are optional. Short of any of them, or of `git` on the machine, drafts and links
   work as before and the page offers no Save. The site reads Save's fields with defaults, so a
   site newer than the service still reads its drafts.

## Consequences

- The Railway service needs a volume, `git` in its image, and three more variables, and the
  repository needs a GitHub App (`docs/DEPLOY.md`, step 1b). A full clone is about 60 MB today and
  a worktree is the checked-out files, with nothing installed in it; 1 GB of volume is ample for
  this part. The agent's part will need more, for dependencies in a worktree.
- A pull request opened here does not satisfy the repository's own rule that a puzzle's design
  file and guide change with its numbers. That is why it is a draft and says so, and it is what
  Save's finish (the last part of this step) is for. Until then the owner finishes it by hand or
  with an agent session of their own.
- The service does not know whether a build plays the numbers it writes: it imports no engine
  (ADR 0043 decision 3). The page refuses to Save a draft the current build refuses, and the pull
  request's CI loads the content file with the game's own validation.
- A draft clears when its pull request is closed without merging, and the numbers go with it.
  They are still in the closed pull request and in every tester link Save made.
- The service runs `git` as a child process, and a token is in that child's environment for the
  length of one command. The process boundary that matters is the agent's, and the agent's part
  draws it (a separate unix user); nothing here has to change for that.
- Decision 7 of ADR 0042, the live build of a draft's worktree, is not built here and nothing
  here builds toward or against it.

## Alternatives considered

- **Write the file through GitHub's contents API, with no clone.** No volume and no `git`, for
  numbers. The agent needs a checkout to edit and run things in, so the clone would arrive one
  part later with none of it proven.
- **Rewrite the content file from its parsed form.** A few lines of code, and every Save would
  reflow every hand-laid threshold table and deck in the file.
- **Write the branch file as the base file plus the overlay each time.** It puts numbers back for
  free, and wipes any other edit to that file on the branch.
- **Rebase the draft onto the moved base.** A cleaner history for a branch that is squashed on
  merge anyway, at the cost of rewriting commits that a pull request and, later, per-turn reverts
  point at. ADR 0042 already says never on its own; this says never.
- **Open the pull request as the owner**, with a token from their sign-in. It would need a scope
  that can write to the repository held for every signed-in session. The owner chose the App.
- **Hold the Save request open until the pull request exists.** The tester link would then wait
  on a push, and "at once" is the point of making it first.
