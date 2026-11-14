# 0049. Save ends at the draft pull request: the checklist is a developer's to finish

Status: Accepted. Supersedes the third stage of [0042](./0042-the-harness-becomes-the-puzzle-studio.md)
decision 10 ("then, in the same agent session, the puzzles skill's checklist for a changed puzzle
(design file, guide, capture, strings), further commits, and the pull request marked ready"), the
consequence beside it ("Save takes minutes to finish"), and the alternative that ADR weighed and
turned down, "a fast Save that commits the numbers and leaves the rest", which is now what Save
is. The rest of decision 10 stands: the tester link first, then the commit, the push and the draft
pull request, later Saves adding commits, and no rebase. Builds on
[0046](./0046-save-writes-a-drafts-numbers-to-a-pull-request.md) and
[0047](./0047-the-chat-runs-an-agent-the-service-holds-to-the-puzzle.md).

## Context

ADR 0042 gave Save three stages and M9's second step was planned as four parts, the last of them
Save's finish: after the draft pull request, the chat's agent would work the puzzles skill's
checklist for a changed puzzle, add commits, and mark the pull request ready with the skill's
report as its body.

With the first three parts built and used, the owner decided against the fourth. Save should open
the pull request for what the draft holds, its numbers and whatever the agent edited in the chat,
and stop. A developer who wants the design file, the guide, a capture and the strings brought in
step does that on the pull request, by hand or with an agent session of their own.

Building the third part also showed a gap in the second: Save was offered only when a number
differed from the shipped ones, so a draft whose only change was the agent's edit to a file could
not be saved at all.

## Decision

1. **Save has two stages and no third.** A tester link at once; then the draft's numbers written
   into the content file, a commit, a push of that and of every commit the chat's turns made, and
   a draft pull request from the studio's GitHub App with the owner named in its body. No agent
   runs as part of Save, and Save spends nothing against the chat's cap.
2. **The pull request stays a draft, and says what is left.** The studio never marks it ready.
   Its body says what it holds, the numbers changed and the files the agent edited, and that the
   rest of what a changed puzzle needs is for a developer to finish before marking it ready.
3. **A draft the agent edited can be saved though no number differs.** A draft has something to
   save when it changes a number or when a turn of the chat has committed an edit. The page offers
   Save in either case, and the service still answers that there is nothing to save when the
   branch holds nothing the base branch lacks.
4. **The pull request is named for what it holds.** One that changes only numbers is titled as a
   tuning; one that carries the agent's edits is titled as a change, and lists those files. A
   later Save brings the title and body up to date with the branch.
5. **The checklist is still the rule.** `CLAUDE.md` and the puzzles skill are unchanged: a
   puzzle's design file and guide change with its rules and numbers. What changes is who sees to
   it. The chat's agent can be asked to, a turn at a time, before Save; nothing makes it.

## Consequences

- M9's second step is complete with three parts. What is left of M9 is its third step, assets
  (ADR 0042 decision 12), and the live build of a draft's worktree (decision 7), which is still
  not built.
- A pull request saved from the studio does not meet the repository's own rules until a developer
  has finished it. That is the trade the owner chose: Save is quick and predictable, and the
  finishing is a person's judgement.
- Save takes seconds, not minutes, whatever the draft holds.
- DESIGN.md 3.14's table of what the studio answers the puzzles skill with loses two rows' worth
  of promise: the three homes are kept in step by a developer, and the report of bar items is
  theirs to write.
- Nothing built for the chat is wasted: the agent session, its scope and its per-turn commits are
  how the edits a Save carries are made.

## Alternatives considered

- **Build the finish as planned.** It makes every saved pull request whole, at the price of a
  model run on every Save, minutes of waiting, spend the owner did not ask for at that moment,
  and a pull request marked ready on an agent's say-so.
- **Offer the finish as a button beside Save.** The chat already is that button: the owner can
  ask the agent to work the checklist before saving, and see and revert what it does.
- **Open the pull request ready for review.** It would claim a completeness the studio has not
  checked.
