# 0045. Drafts are kept by the studio's service, and an address's numbers are never saved unasked

Status: Accepted. Builds on [0042](./0042-the-harness-becomes-the-puzzle-studio.md) decisions 2 and
4 and on [0043](./0043-the-studio-service-starts-with-tester-links.md). It supersedes nothing: it is
the first part of M9's second step (chat and Save), and says how the drafts ADR 0042 gives the
service are stored and how they meet the query string a draft has lived in until now.

## Context

ADR 0042 says a draft is an overlay first, that there is one a puzzle for now, addressed by an id
so that variants can follow, and that the service holds the drafts. The shell (ADR 0043) built the
service with tester links only, so a draft still lived in a studio page's address and nowhere
else. It did not follow the owner to another machine, the home grid could not mark it, and Save
(the next part of this step) has nothing to hang a worktree and a pull request on.

The query string cannot simply go away. A `/play/<puzzle>` link is one, the deploy check's deep
link is one, and it is what makes the studio work with the service down (ADR 0043 decision 8). So
a studio page can now be handed two drafts at once: the one the service keeps for its owner and
the one in the address it was opened on, which may be a link somebody else sent.

## Decision

1. **A draft is a row in the `studio` schema: an id, a puzzle, its owner's login, the numbers and
   a revision.** The numbers are exactly what a tester link freezes (ADR 0043 decision 2): config
   overrides by path, `roundSeconds`, `paceSeconds`, `thresholds`, and the seed if one is pinned.
   The id has a tester link's shape and is the draft's address on the service
   (`PUT /drafts/<id>`). A unique index on owner and puzzle is the whole of "one a puzzle"; variants
   lift it and change nothing else. Picks, the chat, the worktree and the pull request join the
   row in the parts that build them.
2. **A draft is the owner's alone.** Every route under `/drafts` needs the session; a draft is
   found only by its owner, and another allowlisted login is told there is no such draft. As for
   tester links, the service checks a draft's shape and not whether it plays (ADR 0043 decision 3):
   a draft holding a number the build refuses is still the owner's draft, and the page says so on
   the control.
3. **A save names the revision it was made from.** The service counts a draft's saves. A save
   whose revision is no longer the stored one is refused, and so is opening a second draft for a
   puzzle. Two pages open on one draft cannot overwrite each other without either being told.
4. **A studio page is on the stored draft or on its address, never a blend, and says which.**
   - Opened on a bare address by the signed-in owner, the page takes the stored draft. Changes are
     saved to it and the address stays bare. The row is made by the first change, so opening a
     page marks nothing.
   - Opened on an address that carries numbers or a seed, the page plays those, exactly as before,
     and saves nothing. The tuning panel says so and offers the two ways out: keep these as the
     draft, replacing the stored one, or open the stored one and drop them. An address that says
     what the stored draft already says is simply the draft.
   - Signed out, with no service, or with one that does not answer, the address is the draft, as
     it has been since ADR 0019.
5. **Whatever the service fails at ends with the numbers in the address.** A save that was not
   taken, a draft changed or discarded from somewhere else, and signing out all leave the page on
   its own numbers with the address carrying them, which is the second case of decision 4. Nothing
   tuned is lost with the service, and there is one way back in: the owner says which to keep.
6. **Two resets, as DESIGN.md 3.14 has them.** Clearing all numbers keeps the draft, since a draft
   will hold more than numbers. Discarding a draft deletes its row, after a confirmation, and puts
   the page back on the shipped numbers.
7. **Only a studio page asks.** `/play` pages, the studio's pages on a phone and the home grid's
   thumbnails ask the service nothing about drafts. The home grid asks once, for the signed-in
   owner, which puzzles have a draft open, and marks them.

## Consequences

- There are no new credentials and no new variables. The service gains one table and migrates
  itself at startup, as it already does.
- A link opened by the signed-in owner costs a click before it can become the draft. That is the
  point: a link someone sent cannot replace a draft by being opened.
- The studio page's address no longer shows the owner's draft while the service keeps it. The
  panel's play link still copies the draft as a query string, and a tester link freezes it.
- Signing in from a page with numbers on it comes back to that address, so work done signed out
  is offered as the draft, not adopted.
- A change made in the half second before a page is left is sent as it goes. A change made while
  the service is unreachable is in the address and nowhere else until the owner keeps it.
- The pull request mark on the home grid, and a draft clearing when its pull request is merged or
  closed, wait for Save.

## Alternatives considered

- **Keep the address in step with the stored draft.** Every reload would then meet two drafts,
  and after a change on another machine they would differ, with nothing to say which is newer.
- **Let the address win, or the newest.** Both overwrite a stored draft because a link was opened.
- **Merge the two key by key.** A draft is tuned as a whole; half of one and half of another is a
  third thing nobody chose.
- **Last save wins, with no revision.** Simpler, and the agent's tool that sets numbers (the chat,
  later in this step) is a second writer from the day it lands.
- **Address a draft by its puzzle.** One fewer id today, and variants would then need a new
  address and a migration of everything that points at a draft.
