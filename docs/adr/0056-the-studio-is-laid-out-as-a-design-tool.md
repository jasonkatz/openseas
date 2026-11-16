# 0056. The studio's page is laid out as a design tool: a top bar, a rail of modes, one panel

Status: Accepted. Builds on [0042](./0042-the-harness-becomes-the-puzzle-studio.md) decision 1,
on [0045](./0045-drafts-are-kept-by-the-studio-service.md),
[0046](./0046-save-writes-a-drafts-numbers-to-a-pull-request.md),
[0047](./0047-the-chat-runs-an-agent-the-service-holds-to-the-puzzle.md) and
[0050](./0050-a-frame-or-a-cue-can-be-swapped-on-a-running-board.md). It supersedes the placement
those describe (what sits in "the tuning panel", and ADR 0050's three tabs over the side panel)
and nothing else in them: what the studio does is unchanged.

## Context

The studio's page grew a step at a time. By the end of M9's third step its left column was one
long scroll: the seed, compare, reset, the play link, the redeal switch, the starting points, the
draft's state, Save and its pull request, tester links and sign-in, and then every number in six
groups, with Sprites and Sounds as two more tabs over the same column. Everything worked and
nothing had a place: the thing a designer does most (change a number, watch the round) sat under
the things done once a session (sign in, save).

The owner asked for the page to look and feel like a design tool for puzzle designers, and
settled its shape over four wireframes and a clickable mock-up: the chat stays on the right;
where the page is goes top left and what becomes of the draft top right; and the left side
follows a mode picked on a rail of icons.

## Decision

1. **The page is five regions.** A bar across the top, a rail of modes down the left edge, the
   mode's panel beside it, the board in the middle, the chat on the right, and a status line
   along the bottom. The board is in the middle in every mode, drawn exactly as `/play` draws it
   (ADR 0042 decision 11): a mode never changes the stage.

2. **Six modes, in three clusters.** Play; then Setup, Tuning and Scoring; then Sprites and
   Sounds. The rail shows icons, with each mode's name on hover and for a screen reader. A mode
   that holds a change carries a dot. The page opens on Play.

3. **The numbers are split by what they decide, on the groups that already exist.** Every puzzle
   already sorts its config keys into board, deal, pace, scoring and limits
   (`studio/src/tuning/groups`). Setup takes board and limits with the round's length; Tuning
   takes deal and pace, and any key a groups file forgot; Scoring takes scoring with the live
   tier's window and the thresholds. Rating is not a mode of its own: it is a short list and
   belongs with what it rates. `studio/src/studio/modes.ts` holds the split, and a test holds
   every section to exactly one mode. A puzzle's groups file is unchanged, so a new key still
   needs only its line of description and its place in that file.

4. **Play is the round and nothing about the puzzle.** A starting point, the seed, the round
   dealt again, the shipped numbers held against the draft's, and the last rounds finished on the
   page. The starting points sit here and not in Setup: they are what a designer reaches for when
   about to play. The last rounds are the five the frame already keeps for the chat (ADR 0042
   decision 5); nothing new is recorded.

5. **The panel is always there.** In Play it holds the round's controls; it does not fold away
   to give the board the room. Nothing on the page moves when the mode changes.

6. **Every panel stays in the page while one shows**, as ADR 0050 had it for its three tabs: a
   file being tried, a value half typed and a menu's note outlast a look elsewhere. The sections
   of the three numbers modes are one list, of which a mode shows its own.

7. **One search over the numbers.** With the numbers in three places a designer will not always
   know which holds a key. A search in any numbers mode shows the matching numbers from all
   three, each under the mode it is tuned in; turning the rail ends it.

8. **A number is one line.** Its label is its key read as words, with the key as the content
   file spells it and its line of description in the title; a switch in the panel shows every
   line of description. A changed number carries a dot and a button that puts it back. A control
   that does not fit beside its label (a curve, the thresholds, JSON) sits under it. The label is
   derived from the key, not written: it is the key in another spelling, so it is not a string
   for the message table, and a new key needs no new string.

9. **What the draft changes is in the top bar.** A count, which opens the list: each number
   with its value and the shipped one, each picked take, a way to its control, a button that puts
   it back, and Reset all. While the server would refuse the draft the count says that instead.

10. **What becomes of the draft is top right.** Whether the service has it; a Share menu with
    the play link, tester links, sign-in and discarding the draft; and Save. Save is one press,
    and opens the sheet beside it, which holds a name for the tester link and how the draft
    stands with its pull request (ADR 0046). A dot on the sheet's button says when it holds
    something to act on: a failed Save, or `main` moved under the draft. An address's numbers
    that are not the owner's draft (ADR 0045) are too important for a menu: a band under the top
    bar says so and holds the two ways out.

11. **Sprites is a grid and Sounds a list, each with one picked out.** A frame's tile shows it
    at board size; the frame picked out shows it larger with its takes, the file to try and the
    two buttons that write to the chat. A cue's row plays it and names its voice; the open cue
    shows its voices, takes and file. Picking, trying a file and what the board does are as ADR
    0050 to 0052 have them.

12. **The studio's chrome is flat and dense; the board is not.** The bar, rail, panel and chat
    share one small set of styles under one class, in the game's own colors and typefaces. The
    board in the middle keeps the styles `/play` gives it.

## Alternatives considered

- **Keep three columns and add a toolbar.** The smallest change, and it leaves the left column
  as long as it was.
- **Click a piece on the board to inspect it.** The most like a design tool, and the largest
  build: every board would have to report what was clicked. It can be added to this layout
  later without moving anything.
- **A timeline dock under the board.** Plots a round and scrubs its replay. Useful, and it costs
  the board height on a short screen. The last rounds in the Play panel are the first step
  toward it.
- **The chat leading on the left.** Slower for tuning by hand, which is most of what is done.
- **A bar of modes under the board** instead of a rail. It costs the board height and does not
  grow.
- **A mode that changes the middle** (a rating scale in Scoring, a paused board in Sprites).
  Left out for now: the board always in the same place is worth more.

## Consequences

- The smoke finds a control by the same test id as before, but a control out of sight must be
  brought forward first: `e2e/helpers.ts` has `shown`, which turns the rail or opens the menu
  that holds it.
- `TuningPanel` no longer holds the seed, the draft or the links. `studio/src/studio` holds the
  shell, the top bar, the Play panel, the modes and a menu; `DraftSection` is the band, the
  status, Save and discard as four parts.
- The strings for the three tabs and the two panels' opening lines are gone; the modes, their
  one line each, the menus and the status line have strings of their own.
- A new mode is a line in `modes.ts`, an icon, two strings and a panel.
