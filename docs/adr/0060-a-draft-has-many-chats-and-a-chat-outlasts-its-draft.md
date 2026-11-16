# 0060. A draft has many chats, a chat outlasts its draft, and the page lists them

Status: Accepted. Builds on [0047](./0047-the-chat-runs-an-agent-the-service-holds-to-the-puzzle.md)
and [0055](./0055-the-chat-is-told-as-it-happens.md). It supersedes three sentences of ADR 0047:
decision 8's "Each line of a chat ... is a row of the draft's, and goes with the draft"; decision
5's "the agent's session is resumed", which now means the chat's session, not the draft's; and
decision 6's "Each draft still shows what it has spent", which is now each chat. Everything else
in ADR 0047 and ADR 0055 stands: the agent's user, its environment, the proxy, the scope, a turn
and its commit, the cap, the stream over the rows.

## Context

The chat of ADR 0047 was one conversation a draft, with one agent session, and its rows were the
draft's. That made three things the owner wanted impossible. A new line of work could not start
afresh: every question went into the one conversation, with everything said before it. Nothing
earlier could be found again: there was no list, only the one log. And every chat was lost when
its draft went, which is not rare: a listing clears a draft whose pull request merged or closed
(ADR 0046), and the owner discards drafts to start over. What the agent was told and said about a
puzzle, often the reasoning behind a change, went with it.

## Decision

1. **A chat is a row of its own.** `studio.chat` holds a chat: its owner, its puzzle, the draft it
   is on, a title, the agent session it resumes, how many turns it has run and what it has cost.
   Its lines are `chat_item` rows of the chat's; each still names the draft whose turn it was. The
   migration makes each draft's one chat its first, under the draft's own id, with its session,
   turns and spend, and the title of its first message.
2. **A draft has as many chats as the owner starts, and runs one turn at a time.** A message names
   the chat it goes to, or none, which starts a chat titled by the message's first words. Each chat
   is its own conversation, with a session of its own. A draft has one worktree and one branch, so
   while one of its chats runs a turn another of them waits: the service refuses its message as
   `busy`, and its stream says so, and says again when the draft is free. A message to the chat
   whose turn runs still steers that turn (ADR 0047 decision 5). Turns are still numbered by the
   draft, whichever chat ran them, since a turn is a commit on the draft's branch and its revert
   names it.
3. **A chat outlasts its draft.** When a draft goes, its chats stay, on no draft, every line kept.
   Their turns' commits went with the draft's branch, so those lines no longer offer a revert, and
   a question a turn put to the owner is no longer anyone's to answer.
4. **A chat from a draft that is gone can be carried on.** A message to it from the puzzle's open
   draft moves it onto that draft. Its session was the old worktree's and cannot be resumed there,
   so the agent starts a new one, and its first message is the earlier conversation (the owner's
   words and the agent's replies, the latest 24,000 characters of them) with a note that its work
   went with the draft and is in main now or nowhere. Its later turns resume the new session. A
   chat on another open draft is not carried: there is one draft a puzzle, and the service refuses.
5. **The page lists every chat on the puzzle.** The chat's head is a button with the open chat's
   name that opens the list over the log: the open draft's chats, then those from drafts that are
   gone, each the one last spoken in first, with when, how many turns and what it cost, and a mark
   on the one running. A row opens its chat; "New chat" opens an empty one that the next message
   starts. The open chat can be renamed and deleted from its own menu; deleting takes its lines and
   leaves its turns' commits on the draft. A reload opens the chat last open on that puzzle's page,
   else the draft's running chat, else the draft's chat last spoken in, else a new one. The
   service's routes for a chat move from under its draft to `/chats/:id`; a message is still sent
   to its draft.
6. **The page says what the owner needs to act.** A chat from a draft that is gone says so above
   the box, and what a message will do. A chat waiting on another says so, with a button to the
   one running, and its Send is off. A reply can be copied as written. Scrolled back, the log offers
   a button to its end. The box grows with what is typed.

## Consequences

- An owner can start afresh without losing anything, and can read what was said about a puzzle
  long after the draft it was said on has merged.
- Chats accumulate. Nothing deletes one but the owner. They are small rows, and the list is
  filtered by words once it is long.
- A carried chat's agent knows what was said, not what was done: its work is in main, or gone, and
  it is told to look. Its first message costs what the earlier conversation weighs, up to the cap.
- The spend shown is the chat's beside all drafts' against the cap; a draft's own total is still
  kept on its row and no longer shown. A chat's spend is all its turns metered, the generation
  scripts' APIs included, which the proxy meters as they bill (ADR 0059).
- The stand-in service of the studio's smoke keeps chats as the service does, so the list, a new
  chat, a carried chat and a waiting chat are driven on the page; the turns, the sessions and the
  migration are proven in the service's own tests against Postgres and `git`.

## Alternatives considered

- **A new chat as a new draft.** Drafts are one a puzzle, and a second worktree for each chat would
  split the owner's numbers and edits across branches no one asked for.
- **Several turns at once on a draft, one per chat.** They would write one worktree and one branch
  together, and each turn's commit would hold the other's edits. One turn at a time is what makes a
  turn's revert mean anything.
- **Keep a chat's lines but drop the chat with its draft.** It is what the owner asked not to
  happen.
- **Resume the old session on the new worktree.** Claude Code keeps sessions by the directory they
  ran in, and the old one is gone; copying transcripts between project folders is the SDK's
  business, not ours, and the agent would remember files that are not there.
- **Summarise the earlier conversation with a model before carrying it.** A second model call the
  owner did not ask for, paid for against the cap, and a summary that might drop what mattered. The
  words themselves, cut from the start when long, are exact.
