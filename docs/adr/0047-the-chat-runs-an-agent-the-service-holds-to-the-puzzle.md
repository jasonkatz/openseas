# 0047. The chat runs an agent as its own user, behind the service's proxy, under one spend cap

Status: Accepted. Builds on [0042](./0042-the-harness-becomes-the-puzzle-studio.md) decisions 5, 6,
8 and 9, on [0045](./0045-drafts-are-kept-by-the-studio-service.md) and on
[0046](./0046-save-writes-a-drafts-numbers-to-a-pull-request.md). It is the third part of M9's second
step. It supersedes one sentence of ADR 0042 decision 9, "Each draft shows what it has spent and
stops at a cap the owner sets": there is one cap, for all drafts together (decision 6 below).
Everything else in ADR 0042 stands, decision 7 included, which is still not built.

## Context

ADR 0042 says what the chat is: the Claude Agent SDK on the draft's worktree, loading `CLAUDE.md`
and the three puzzle skills from it; Sonnet unless Haiku or Opus is picked; a tool that sets the
draft's numbers; the puzzle's own files writable and anything else refused until the owner allows
it; every turn a commit; a message sent meanwhile steering the turn. It also says this is the
first place in the project where a model runs commands unattended, and names what bounds it.

The owner settled three things before this was built. The agent's processes run as a unix user
of their own with a scrubbed environment, and the Anthropic key, the GitHub App's key, the session
secret and the database's address never reach the agent's shell; outbound network is not
restricted, and the owner accepted that. There is one spend cap, not one a draft, and a turn that
reaches it is stopped where it stands. And Save came first, so the clone, the worktrees and the
push path were already there (ADR 0046).

## Decision

1. **The agent's processes are another unix user's.** At startup the service makes a user,
   `studio-agent`, with a home on the volume, and runs the SDK's Claude Code process as that user.
   Before a turn the draft's worktree is handed to it file by file. It owns nothing else: the
   clone behind the worktree stays the service's, readable and not writable, so the agent can read
   history and cannot touch the clone's configuration, hooks or other drafts. Only root can
   become another user, so in production a service that is not root, or cannot make the user, or
   whose volume that user cannot walk into, has no chat and says why in its log. Off production
   the agent runs as the service's own user, with a warning: a developer's machine is not the
   thing being protected.
2. **Its environment is built from nothing.** The process is started with a path, the agent's
   home, where to find a model, a token for this turn, and the two keys the generation scripts
   read (`OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, ADR 0040). Nothing is inherited from the
   service's environment. Settings are read from the worktree alone (`CLAUDE.md`, the skills),
   never from a home directory or the machine.
3. **The agent reaches a model only through the service.** The service listens on the machine's
   loopback address and passes Messages API requests on to Anthropic with the real key in place of
   the turn's token. So the Anthropic key is never in the agent's process, a token opens nothing
   once its turn is over, and every response is metered by the service before the agent reads it.
4. **The service holds the agent to the puzzle's own files, twice.** A puzzle's files are the
   ones that carry its id, a folder named for it or a file whose name starts with it, under the
   packages a puzzle is made of (`engine`, `protocol`, `content`, `boards`, `docs`, and the
   studio's page and tuning group for it) and the two folders of design files; and two shared
   files every puzzle's strings and frames live in (`messages/en.json`, the sprite atlas's
   `frames.json`). Before a tool that writes a file runs, the service is asked, and a path that
   is not the puzzle's is refused with words telling the agent to stop and say what it needs.
   Commands run without asking, and a command can write anywhere its user can, so when a turn
   ends the service looks at what changed in the worktree and puts back whatever is outside the
   puzzle's files before it commits. Either way the owner is shown the path, in the chat, with a
   button that allows it for this draft; a folder allows what is under it; `.git` is never
   allowed. A path outside the worktree is refused and is nobody's to allow.
5. **A turn is one process, one commit, and can be undone.** A message starts a turn: the agent's
   session is resumed, it works, and when it ends the service commits what it changed, as the
   studio, on the draft's branch. The agent is told not to commit, push or switch branches, and
   cannot push: no credential that can is in its reach (ADR 0046 decision 6). Reverting a turn is a
   new commit that undoes that one; nothing is rewritten, and a turn that no longer comes out
   cleanly is not reverted. A message sent while a turn runs joins it. Stop ends the process, and
   what it had changed is committed all the same, so that it too can be reverted. Save and a turn
   do not write a branch at once: each is refused while the other runs.
6. **One cap, all drafts together, enforced where the agent cannot reach.** `STUDIO_SPEND_CAP_USD`
   is all the chat may spend. The proxy of decision 3 adds up what each response cost, from the
   usage in it and a table of prices kept beside it, into one meter that outlasts the drafts it was
   spent on. When the meter reaches the cap the running turn is stopped there and then, not
   allowed to finish, and the proxy refuses anything more; no draft starts a turn past it. Raising
   the variable is how the owner carries on. Each draft still shows what it has spent, beside
   the meter and the cap. The meter is the studio's guard against a runaway turn, an estimate
   and not a bill.
7. **Numbers move through a tool, in the service's process.** The agent has two tools of the
   studio's own, always in its hands: one sets or puts back draft numbers by the key the content
   file uses, one reads them. They run in the service, on the draft's row, as a save does (ADR
   0045), and the page follows the row: the controls move and the board deals again. The service
   still imports no engine, so it cannot say whether a build plays a number. The page can, and
   each message carries what the build refuses, with the draft's numbers and a line for each of
   the last rounds played (seed, score, tier, length, moves).
8. **The chat is rows, and the page asks for them.** Each line of a chat (the owner's message, the
   agent's words, a step and its outcome, a refused write, how a turn ended) is a row of the
   draft's, and goes with the draft. While a turn runs the page asks for the chat again every
   second or so. The agent's replies arrive a block at a time, whole, and are shown as written:
   the one text in the studio that does not come from the message table (ADR 0042).
9. **A code change is seen on the pull request's preview.** Decision 7 of ADR 0042, a live build
   of the worktree in a frame, is not built. Until it is, the board beside the chat runs the
   deployed build with the draft's numbers; the agent is told so, and told to say so whenever it
   edits code.
10. **Without its variables the service says it has no chat.** It needs Save's (ADR 0046), the
    Anthropic key and the cap. Short of any, drafts, links and Save work as before, and the page
    shows no chat. The model each of the picker's three names runs is the service's to know.

## Consequences

- What bounds the agent is decisions 1 to 6 together. What does not: it can reach the network, it
  holds the two script keys, it can read the whole repository and the clone's history, and while
  a turn runs its token can ask the model for anything, which the cap bounds. A command it starts
  can do whatever an unprivileged user on that machine can do.
- The service must start as root on Railway and needs `useradd`. Its image grows by the Claude
  Code executable, some hundreds of megabytes. The volume now holds dependencies wherever the
  agent installs them to run a puzzle's tests, and the agent's session transcripts in its home:
  5 GB, and memory to match a test run (`docs/DEPLOY.md`).
- The end-of-turn sweep means a command's write outside the puzzle's files is lost, not kept
  aside. The agent is told to ask first, and the owner sees every path that was put back.
- The prices are in the service's code. A new model, or a changed price, is a change there; a
  model the table does not know is priced as the dearest it does, so the meter errs toward
  stopping early.
- A turn's first message waits for the worktree, and its first use of a puzzle's tests waits for
  an install. Nothing is installed ahead of need.
- Replies are not streamed a word at a time. If that is missed it is a change of transport, not
  of anything decided here.
- The agent's own adapter is exercised in the service's tests with the real Claude Code
  executable, as another unix user where the machine allows, against a stand-in for Anthropic's
  API that plays a script of tool calls. No real model has run a turn in those tests.

## Alternatives considered

- **Give the agent's process the Anthropic key.** It is how the SDK is usually run, and the key
  would then be in the environment of every command the agent starts.
- **Let the Claude Code process enforce the budget** (its own budget option). It does stop a
  turn in mid-flight, and it is the agent's own process doing it, with the agent's user able to
  signal it. The service's proxy meters the same traffic from outside.
- **A container or a sandbox for each turn.** Stronger than a unix user, and a second thing to
  build images for, start and tear down, for one user. ADR 0042 already weighed a fresh sandbox a
  session and chose a long-lived service; this draws the line the owner asked for inside it.
- **Refuse every command and allow only file tools.** The scope would be exact, and the agent
  could not run a puzzle's tests, the capture or the generation scripts, which is most of what
  the puzzles skill asks of a change.
- **Keep an out-of-scope write aside instead of putting it back.** A second copy of the tree to
  manage and explain, for a case the agent is told not to create.
- **Commit a tool call at a time.** Finer undo, and a branch of dozens of commits a turn that no
  reviewer wants. A turn is the unit the owner asked for and watched.
- **A stream of server-sent events for the chat.** Livelier, and a held connection and a second
  code path on both sides. The rows had to exist anyway, so that a chat survives a reload.
- **A cap a month, or a cap a draft.** The owner asked for one cap. A month's would be a second
  decision about when it resets; raising one number is not.
