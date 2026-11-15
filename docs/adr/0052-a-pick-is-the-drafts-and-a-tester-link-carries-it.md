# 0052. A pick is the draft's: kept with its numbers, frozen in a tester link, and loaded by `/play`

Status: Accepted. Builds on [0042](./0042-the-harness-becomes-the-puzzle-studio.md) decisions 2
and 11, [0045](./0045-drafts-are-kept-by-the-studio-service.md),
[0050](./0050-a-frame-or-a-cue-can-be-swapped-on-a-running-board.md) and
[0051](./0051-takes-are-kept-in-a-railway-bucket-by-their-hash.md). It is the third part of M9's
third step, assets. It supersedes one thing the studio has held to since ADR 0043: that a `/play`
page asks the studio's service for a tester link and nothing more. A page whose draft picks a
take now also asks for that take. Save placing picks is the part that follows.

## Context

ADR 0042 decision 2 says a draft holds numbers and picks, a pick being a take for a sprite frame
or a sound cue, and that both apply in the browser with no agent and no rebuild. Decision 11 says
a tester link is a frozen overlay of numbers and picks. ADR 0045 built the draft with numbers
only. ADR 0050 built the swap on a running board, and ADR 0051 the takes, which a tap could put
on the board of one page and no further.

## Decision

1. **Picks are kept beside the numbers, in the same object.** A draft's numbers gain `picks`:
   for sprites, a take's hash by frame name; for sounds, a take's hash by cue name, or `synth`
   for the synthesized cue over a bundled sample (ADR 0041). A frame or a cue with no entry is
   as the build ships it. They are saved with the numbers, under the same revision, so a second
   page cannot overwrite a pick unseen any more than a number. The service checks only the
   shape: a name a script could have written, and a hash. A hash that names no take is not
   refused; the board shows the shipped art there, and the page says so.
2. **A draft or a link kept before picks has none.** The field is defaulted on the wire and
   optional as kept, and the service sends every draft and link with its picks whole.
3. **A site newer than its service leaves picks with the page.** The service says whether it
   keeps picks (`picks` beside `takes` in what it says of itself). Where it does not, picks are
   left out of what is sent and compared, and stay in the address while the numbers are stored:
   a service that dropped them would otherwise have the page saving the same draft for ever.
4. **The address carries picks as it carries numbers.** `sprite.<frame>=<hash>` and
   `sound.<cue>=<hash|synth>`, on a studio page and on `/play` alike. One that is not a pick's
   shape is dropped alone. Signed out, the address is the draft, picks included.
5. **The round's frame puts picks on the board.** The same frame that lays the numbers over
   content gives each picked frame and cue to `boards` through the swap of ADR 0050, reading the
   take from the service by its hash, and gives back what the draft lets go. A take that cannot
   be read leaves that frame or cue as shipped, and the frame says which. A home thumbnail is
   the shipped board.
6. **A tap in a row is a pick.** In the sprite and sound panels a take's button picks it into
   the draft, a second tap or "Put back" lets it go, and the row says which take is picked. A
   file from the owner's machine is still a trial on that page (ADR 0050): it sits over the pick
   while it is tried and gives way to it again.
7. **Reset all clears picks with the numbers.** It is the second of the four ways back in
   DESIGN.md 3.14. A starting point is numbers and leaves picks alone. Holding the shipped
   numbers up for comparison does not put the shipped art back: that would make the board again
   on every press.
8. **A tester link freezes the picks.** Making a link copies them with the numbers. `/play/<id>`
   plays on them: it reads the link, then each picked take by its hash, with no sign-in. Its
   details sheet says how many frames and cues the link changes and how many could not be
   loaded. A link whose take cannot be read still plays, on the shipped art for that piece: art
   is not a rule, and nothing about the round changes.
9. **The agent is told the picks and cannot make one.** Each message carries the draft's picks
   under its numbers, by the start of each take's hash. The owner picks every take (ADR 0040);
   the agent has a tool for numbers and none for picks.

## Consequences

- `/play` leans on the service for more than a link once a link holds a pick: each take is one
  request, answered to be kept for good (ADR 0051), so a tester pays it once.
- A pick names a take by hash and nothing checks that the take suits the frame it is picked for.
  The panels only offer a frame its own takes; a hand-written address can pick any.
- Save does not place picks yet. Until the next part, a Save's tester link carries the picks,
  and its pull request holds the numbers and the agent's edits only; a draft whose only change
  is a pick has nothing Save will take. Landing a picked take still means asking the agent to
  place it.
- The page holds a pick's art from the moment its take loads. Until then the board shows the
  shipped art, for a moment on a fresh page.
- The name `DraftNumbers` now holds more than numbers. Renaming it touches every caller for no
  change in what is kept; the schema's comment says so.

## Alternatives considered

- **A second object and a second revision for picks.** Two saves to keep in step, and a link
  would have to freeze both at one moment.
- **Refuse a pick whose take the service does not keep.** The service would have to hold the
  draft to the bucket's contents on every save, and a link would break when a take was ever
  cleared out. Shape is checked; presence is the page's to report.
- **Deal nothing when a link's take cannot be read**, as for numbers a build refuses. Numbers a
  build refuses would play a different game; a missing picture plays the same one.
- **Keep picks out of the address.** Signed out, or with the service down, there would be no
  way to look at a pick at all, and the studio is meant to work without the service.
- **Give the agent a tool that picks.** It could show its shortlist on the board. The rule is
  that the owner picks, and the rows already put every take one tap away.
