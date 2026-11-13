# 0042. The harness becomes the puzzle studio: live tuning, an agent on a worktree, and tester links

Status: Accepted, and built in three steps (DESIGN.md 5.2, M9). Until a step lands, the harness
stands as the ADRs below describe it. Builds on [0018](./0018-one-experience-and-a-puzzle-harness.md),
[0036](./0036-prototype-puzzles.md), [0040](./0040-generated-art-and-sound-from-briefs.md) and
[0041](./0041-sampled-sounds-over-synthesized-cues.md). Supersedes, as each step lands:

- [0019](./0019-boards-package-and-harness-bench.md) decision 5 (the bench's round files and
  review), the lab clock's slow, pause and step from decision 3, and the query string as the only
  form of a scenario from decision 4. Decision 4's two checks stand and gain a third reader.
- [0028](./0028-standing-is-earned-in-the-game.md) decision 2 (a harness round recorded through
  the server).
- [0036](./0036-prototype-puzzles.md) decision 1's recorded harness round. A prototype is still a
  whole registered engine the server can replay.
- [0040](./0040-generated-art-and-sound-from-briefs.md) decision 2's `.art/` as the only home of a
  take. It stays the home of a take made on a developer's machine.

[0027](./0027-voyage-bench-sails-the-engines-as-the-server-does.md) is untouched: the voyage bench
stays as it is.

## Context

The harness was built to prove engines: a practice frame per puzzle, and around it a bench of lab
rounds, an inspector, a replay check, round files and a clock that steps (ADR 0019). That work is
done. Fifteen engines replay clean, and what the owner does on the harness now is tune: change a
number, play a round, change it again, swap a sprite, wonder how a sound would land, send a
friend something to try on a phone.

The bench serves that badly. A number is a form field under a scenario panel, and it reaches the
repository by hand. Sprite and sound takes are files in a gitignored folder on one machine,
reviewed in a generated page (ADR 0040). A tuned round is shared as a long query string that opens
the whole bench. A rule change means leaving for a terminal and an agent session, then coming
back.

The puzzles skill (`.claude/skills/puzzles/SKILL.md`) already says what a puzzle is held to and
what a change to one must carry with it. The owner asked for an application built around that
loop: tune, look, listen, ask an agent for what a control cannot express, share, and save as a
pull request. The design below was settled with the owner question by question; DESIGN.md 3.14
describes what it looks like in use.

## Decision

1. **The harness becomes the studio.** `packages/harness` is renamed `packages/studio` and stays at
   `test.openseas.online`. Each puzzle keeps its path as its studio page, and the game's seven and
   the eight prototypes are treated alike. The inspector, round files and their review, the
   stepping clock and recorded rounds are removed. The voyage bench stays at `/voyage` with its
   own look and its own smoke. The studio is a desktop tool; on a phone it only plays.
2. **A draft is an overlay first.** A draft holds numbers (overrides on the puzzle's content
   file: every key under `config`, `roundSeconds`, `thresholds`, `paceSeconds`) and picks (a take
   for a sprite frame or a sound cue). Both apply in the browser to the production build with no
   agent and no rebuild, so a control answers at once and works when the studio service is down.
   There is one draft a puzzle for now, addressed by an id so that variants can follow.
3. **An overlay is held to the server's checks.** ADR 0019's rule stands: a tuned config runs
   only if the protocol's wire schema and the engine's `validateConfig` accept it and the schema
   strips nothing. The studio shows a refusal on the control that caused it. After every round the
   studio replays the log from the seed and compares hashes, and says so only when they differ.
   Tuned rounds are local: the server deals shipped content only (rule 2), so nothing tuned is
   ever recorded or rated.
4. **A new service, `packages/studio-server`, on Railway.** One instance, production only. It
   holds a clone of the repository, a git worktree and branch for each draft, the drafts and their
   chat in a database of its own on the existing Postgres, and the tester links. It signs the
   owner in with GitHub against an allowlist of logins in its environment; the game's accounts
   are not involved. Pull request previews of the studio site read tester links from it and offer
   no chat and no Save.
5. **The chat is the Claude Agent SDK on the draft's worktree.** It loads `CLAUDE.md` and the
   `puzzles`, `puzzle-sprites` and `puzzle-sounds` skills from the worktree, so a change to a
   skill needs no change to the service. The model is Sonnet 5.5 unless the owner picks Haiku 5.5
   or Opus 5.5, and can change between messages. Each message carries the draft's overlay and
   picks and a summary of the last few rounds played. A message sent while a turn runs steers
   that turn.
6. **The agent changes numbers through the overlay.** It is given a tool that sets overlay
   values, and the controls move. It edits files only for what no control expresses: rules,
   board code, structural constants, strings, design files.
7. **Code changes are seen in a build of the worktree.** The service runs a development build of
   the draft's worktree, and the studio shows the board from it in a frame, to the signed-in owner
   only, with a mark saying which build is on screen. One such build runs at a time and stops when
   idle. A worktree build is never served to the public.
8. **The service enforces the puzzle's scope.** The agent may write the open puzzle's own files
   (its engine, protocol, content, messages, board, briefs, design file and guide) and run
   commands without asking. A write anywhere else is refused until the owner allows that path
   for the draft, in the chat. Every turn is a commit in the worktree and can be reverted.
9. **The service holds the credentials that reach outward.** The Anthropic key and the GitHub
   App's token stay in the service process. The agent writes commits, a title and a body; the
   service pushes and opens the pull request. The OpenAI and ElevenLabs keys are in the agent's
   shell because the generation scripts read them (ADR 0040). Each draft shows what it has spent
   and stops at a cap the owner sets.
10. **Save shares first and finishes after.** In order:
    - at once, a tester link to the draft's numbers and picks;
    - then the overlay written into the content file, picked takes placed in the atlas and the
      sounds folder, a commit, a push, and a draft pull request from the GitHub App with the owner
      named in its body;
    - then, in the same agent session, the puzzles skill's checklist for a changed puzzle (design
      file, guide, capture, strings), further commits, and the pull request marked ready.

    A draft stays with its pull request until that is merged or closed; later Saves add commits.
    When `main` moves under a draft the studio says so and offers an update. It never rebases on
    its own.
11. **A tester link is a frozen overlay, played with nothing around it.** `/play/<id>` loads the
    puzzle alone, with no sign-in, on the current build with the stored numbers and picks. It
    never expires, the owner can withdraw it, and if the current build would refuse it the page
    says so and deals nothing. A draft with code changes is shared from its pull request's
    preview, at the same path, once that has deployed.
12. **Takes live in object storage.** On the studio service every generated take goes to an S3
    bucket under its content hash and is kept across drafts, so a frame or a cue gathers a
    library and a tester link can load a pick. ADR 0040 stands otherwise: takes come from briefs
    through the two scripts, the owner picks every one, and only the pick is committed. `boards`
    gains a way to swap a frame or a cue on a running board. That is presentation and stays within
    its rule.
13. **Thresholds are tuned by hand.** The studio edits `thresholds` and `paceSeconds` like any
    number, and the design file's tuning notes say why. The bot ladder becomes a tool a puzzle may
    use, not a step every change repeats, and rule 17 of the puzzles skill is rewritten with the
    step that builds the tuning panel.

## Consequences

- There is a second service to run, with a volume, three API keys, a GitHub App and a bucket. It
  is the first place in the project where a model runs commands unattended. Decisions 8 and 9 are
  what bound it: a path scope the service enforces, per-turn commits, a spend cap, and no
  credential in the agent's reach that can write to the repository.
- Nothing on the studio sends a round to the server any more. A prototype is still registered and
  the server would replay one (ADR 0036), but what holds a prototype engine to replay day to day
  is its property tests and the studio's silent replay check, both on the same engine code.
- The harness smoke is rewritten to drive every board through its studio page and through
  `/play`, and the rule in `CLAUDE.md` that a board change is proven there stays true. The guides'
  capture (ADR 0038) is repointed at the studio's pages. The deploy check's deep link keeps
  working because the puzzle paths and the old query string are kept.
- A walk through a rejected round's log, move by move, is no longer possible in a browser. The
  engine's tests and a script are what is left for that.
- Save takes minutes to finish, though it shares in under a second. A draft with code changes
  waits for a preview deploy before a tester can see it.
- `CLAUDE.md`, `GLOSSARY.md`, DESIGN.md 4.1 and the skills still say "harness" until the first
  step renames the package; each step updates the words for what it builds.
- Every string in the studio and on `/play` goes through the message table (rule 5). The agent's
  own replies are the exception. The `harness.*` keys of removed tools go with them.

## Alternatives considered

- **The agent only on the owner's machine.** Cheapest and safest, and it would leave the hosted
  site with tuning and links only. The owner wants to open the site anywhere and get a pull
  request.
- **A fresh sandbox for each session.** Better isolation, paid for with a clone and an install on
  every start. With one user, a long-lived service and a worktree a draft is enough.
- **One kind of link that also carries unsaved code.** It means serving worktree builds to the
  public. The pull request preview already exists for that (ADR 0016).
- **A fast Save that commits the numbers and leaves the rest.** It opens pull requests that break
  the repository's own rules. Sharing was the reason to want it, and the tester link is instant
  without it.
- **Keep the bench beside the studio.** The owner no longer uses it, and every panel kept is one
  more thing between the owner and the board.
- **Friendly labels for every config key.** A second vocabulary for fifteen puzzles' numbers,
  when the owner, the agent and the diff all use the key.
- **A studio service for each pull request.** A clone, three keys and an App install a preview,
  for a tool with one user.
