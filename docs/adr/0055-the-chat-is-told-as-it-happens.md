# 0055. The chat is told as it happens: a stream over the rows, replies read as markdown, and a turn that fails says why

Status: Accepted. Builds on
[0047](./0047-the-chat-runs-an-agent-the-service-holds-to-the-puzzle.md). It supersedes two
sentences of that ADR's decision 8, "While a turn runs the page asks for the chat again every
second or so" and "The agent's replies arrive a block at a time, whole, and are shown as
written", and takes up the alternative it set aside, a stream of server-sent events. Everything
else in ADR 0047 stands: the agent's user, its environment, the proxy, the scope, the turn and its
commit, the cap, and the first sentence of decision 8, that the chat is rows.

## Context

The chat of ADR 0047 worked and read as unfinished. A reply appeared all at once, up to a second
after it was written, because the runner told the service only whole blocks and the page asked for
the whole chat on a timer. The agent writes markdown, and the page showed the marks. A step was a
bare line.

It was also brittle, and one failure showed how. The agent's unix user is made again on every
deploy, on a fresh system, and one deploy gave it another uid. Its home is on the volume and was
handed over at its top directory only, so the folder Claude Code keeps session transcripts in
stayed the old uid's. The agent could not save its session, the next turn's resume found no
conversation, and every later turn of that draft failed. The page said "The turn failed." and
nothing else. Reading the code for that failure found others of its kind: a turn the service
could not start left the draft marked as running for good; a stopped agent's request to the model
went on being read, and paid for, to its end; a hung agent held a draft's one turn until someone
pressed Stop.

Vercel's AI SDK was weighed for this and not taken (see the alternatives).

## Decision

1. **The page is told, over one held connection.** `GET /drafts/:id/chat/events` is a stream of
   server-sent events, for the owner alone, as the rest of the chat is. Its messages are the wire
   schema's (`ChatEvent` in `protocol`): `state`, the whole chat; `item`, a line that is new or has
   changed, told apart by its id; `delta`, more words of the reply being written; `status`,
   everything of the chat but its lines (whether a turn runs, the money, the draft). The page
   keeps the chat by applying them in order, in one pure function.
2. **The rows are still the chat.** Nothing is kept for the stream. Every connection starts with
   `state`, read from the rows, so a page that reconnects needs nothing it had and no event is
   numbered or replayed. The service listens before it reads, and lets go of what it heard
   meanwhile after the read, so nothing falls between the two; a line told twice is the same line.
   `GET /drafts/:id/chat` stays, and answers the same `state`.
3. **A reply is shown as it is written.** The runner asks the SDK for partial messages and tells
   the service each run of text as the model writes it. The words are never a row: the service
   keeps the reply so far in memory, sends it in `state` to a page that connects mid-reply, and
   forgets it when the whole block arrives as a `reply` line or the model starts the message
   again. Only the agent's own conversation is shown this way; a subagent's words are not the
   reply.
4. **Replies are read as markdown, by Streamdown.** It is a renderer made for text that is still
   arriving: an unfinished emphasis or code fence is closed for the moment and not shown as stray
   marks. It is used alone, without the rest of the AI SDK, and loaded only when a chat has a
   reply to show. HTML in a reply is shown as written and never becomes elements. A picture is
   shown as its address and not fetched: a reply must not make the owner's browser call wherever
   it says. Streamdown's own buttons are off, since their labels are not from the message table,
   and its classes are Tailwind's, which the site does not have: what it draws is styled in the
   studio's own stylesheet by the `data-streamdown` marks it leaves. A reply the renderer cannot
   read, or a renderer that cannot be loaded, leaves the reply shown as plain text.
5. **When the stream is down the page asks, and says so.** The service sends a beat every fifteen
   seconds; a page that hears nothing for forty takes the connection for dead, whatever the
   browser thinks, and asks for the stream again, more and more slowly, up to every fifteen
   seconds. After four seconds down it says so and asks for the chat the old way, every three
   seconds, until the stream is back.
6. **A session that cannot be resumed is replaced, not fatal.** When Claude Code says there is no
   conversation for the session a turn was to resume, the runner starts the turn again in a new
   session, and tells the agent that its earlier conversation is gone and that the worktree and
   its commits hold the earlier turns' work. The owner's draft carries on; the agent has lost what
   was said, and says so if it matters.
7. **The agent's whole home is made its own at every start.** Not its top directory: everything
   under it, so a uid that moved between deploys cannot lock the agent out of its own files. When
   Claude Code reports that it could not save a session at all, a full volume, the service logs
   it as an error, where its cause is.
8. **A failed turn says why.** The line that ends a turn carries a reason (`agent`, `worktree`,
   `restart`, `idle`) and what was said as it failed, cut short. The reason is shown in the
   message table's words. What was said is shown as it was said, behind a fold, like a step's
   output: it is the agent's or the machine's text, not the studio's.
9. **No failure leaves a draft with a turn that never ends.** A turn whose worktree could not be
   prepared, whose agent could not be started, or whose last line could not be written, is over
   all the same, and the page is told. A turn the service was restarted under is marked as that
   when the service starts, as before, now with its reason.
10. **An agent that says nothing for fifteen minutes, with no tool running, is stopped.** While a
    tool of its runs the Claude Code process is silent for as long as the tool takes, and tools
    keep their own time (a command is cut off at ten minutes at most), so the clock does not run
    then. With nothing running, that long a silence is a process waiting on nothing. The turn ends
    as failed, reason `idle`, and what it had edited is committed like any stopped turn's.
11. **When the agent hangs up, so does the proxy.** A request the agent's process dropped, because
    the turn was stopped or reached the cap, is dropped upstream too, so the model stops writing
    what nobody will read. What had arrived by then is metered all the same.

## Consequences

- Words reach the page as the model writes them, and a number the agent moves reaches the
  controls when it moves, not on the next poll.
- The service holds a connection for each open studio page with a draft. There is one owner, so
  that is a handful. Whatever sits between the page and the service may cut a request that lasts
  too long; the page reconnects and is given the whole chat, which is the path decision 5 already
  needs.
- The stream is one process's memory: what happens in a chat is told to the pages connected to
  the process it happens in. The studio service is one process, and Save, the worktrees and the
  running turns already assume so (ADR 0046, ADR 0047). A second instance would need them all
  reworked, and this with them.
- The reply so far is lost if the service restarts mid-reply. The turn is lost with it (decision
  9), so nothing is shown that is not also gone.
- The studio's bundle gains Streamdown and the markdown parser under it, in a chunk of its own
  that a page without a chat's reply never loads.
- A draft whose session was replaced has an agent that does not remember the conversation. Its
  edits, takes and numbers are all still the draft's.
- The fifteen minutes of decision 10 are in the service's code. The clock stops for a running
  tool because the first version of it did not, and a test with a twelve-second command showed
  the process says nothing while one runs.
- The stand-in service of the studio's smoke answers the stream as a route can: the whole chat,
  and the connection ends, so the page's reconnect is what carries each change. Words arriving
  one event at a time are proven in the service's own tests, against the real Claude Code
  executable and a scripted model.

## Alternatives considered

- **Vercel's AI SDK** (`streamText` on the service, `useChat` on the page). Its server half is a
  tool loop across providers, and the Claude Agent SDK already runs ours, with the write hook, the
  numbers tool, steering and resume that ADR 0047 depends on. Its page half assumes the request
  owns the stream and the browser holds the messages; our turns outlive the request, are rows, and
  can be steered, stopped, reverted and answered from a page that was reloaded. It would also put
  a second wire format beside the Zod contract in `protocol`.
- **assistant-ui**, headless React parts for a chat that render state the page already owns. It
  fits, and it is a large dependency for one panel. Worth another look if the chat grows
  branching or attachments.
- **A WebSocket.** Two-way, and nothing here needs the second way: a message, Stop, an answer
  and a revert are requests that want an answer of their own. Server-sent events are plain HTTP,
  carry the session cookie as every other call does, and need no second server.
- **Number the events and replay from the last one seen.** Exact, and a log of events to keep
  beside the rows, for a chat small enough to send whole.
- **Keep each run of words as a row.** A reply would survive a restart half-written, and a chat
  would be thousands of rows that mean nothing once the whole block is one.
- **Fail the turn when the session is gone, and let the owner start over.** Honest, and it is
  what happened: a draft nobody could talk to. The work is in the worktree either way.
