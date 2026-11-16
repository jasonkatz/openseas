# 0058. The studio's chrome has a look of its own: floating panels, teal for what acts, amber for what changed

Status: Accepted. Builds on [0056](./0056-the-studio-is-laid-out-as-a-design-tool.md). It
supersedes one clause of that ADR's decision 12, that the chrome is drawn "in the game's own
colors and typefaces", and nothing else in it: the five regions, the modes and where everything
sits are unchanged.

## Context

ADR 0056 gave the studio's page the shape of a design tool and left it in the game's look: deep
navy, parchment text, a brass accent, Fraunces for titles and Atkinson Hyperlegible for the rest.
That look was drawn for the game when it was at sea, and on a dense tool it had two costs. Brass
did every job at once: it was Save, the mode picked on the rail, a link, a spinner and the mark
on a changed number, so the one thing a designer scans for (what does this draft change) looked
like everything else. And a serif title face with a storybook feel sat oddly on a page of
sliders and steppers.

The owner asked for the page to feel like a modern design application, and settled the look over
several rounds of mock-ups: three design languages on the existing layout, of which the floating
panels won; then three brandings on that (a cabinetmaker's bench, deep space, a shipyard), of
which deep space won; then its accent, where teal and amber were both liked and each was given a
job of its own.

## Decision

1. **The studio's chrome has its own palette, type and shape, held in `--st-*` variables in
   `studio/src/look.css`.** Nothing in `studio/src/studio/studio.css` reads the game's colors or
   typefaces except the device the board sits in. The board, and everything `boards` draws, is untouched:
   it is still exactly what `/play` draws (ADR 0042 decision 11).

2. **The regions float.** The bar, the rail, the panel and the chat are separate panels with
   rounded corners and a soft edge on a blue-black ground. The board sits on the ground between
   them and the status line is plain text along the bottom.

3. **Teal acts, amber marks a change.** Teal is for what does something and what is picked: the
   filled button, the mode on the rail, a switch that is on, a held or pressed button, a picked
   frame or take, a link, focus. Amber is only for what differs from the shipped puzzle: the
   count on the bar, the dot on a mode, a changed number's dot, name, slider and reset button, a
   changed frame or cue, and the band that says the page is on an address's numbers. A draft
   being saved shows amber too. Refusals stay red and the server's yes stays green.

4. **Color is never the only signal.** Every amber mark is also a dot, a heavier name, a button
   that appears or a word, as rule 6 of the project asks of pieces and as the page already did.

5. **Three typefaces.** Space Grotesk for the wordmark, the puzzle's name, a mode's title and
   the small capital labels; Inter for everything else; JetBrains Mono for numbers, seeds, code
   and the status line. All three come from Google Fonts beside the game's two, which the board
   still needs.

6. **Dark only.** The page has one theme, as the rest of the studio and the game do.

7. **The bar carries the studio's name** before the puzzle's, from the message table's
   `studio.title`.

8. **The home grid and the voyage bench wear the look too, without touching `boards`.** Both are
   drawn with the shared board styles, which the game also loads. `look.css` points the game's
   variables at the studio's on those two pages and restyles what a variable cannot reach (the
   masthead, the tiles, buttons, fields and panels). On the grid a puzzle with a draft open is
   marked in amber, since a draft is a change. The bench's chart colors are left as they were
   checked.

9. **`/play` gets the ground and nothing else.** Its board, HUD, start and result cards and
   details sheet are the game's presentation, and a tester is there to judge the puzzle as a
   player will see it.

## Alternatives considered

- **A hairline, square-cornered console.** Mocked up and set aside: the soft panels were
  preferred.
- **One accent.** Teal alone made a changed number look like a button; amber alone was the old
  brass under another name.
- **A light theme.** The mock-ups had one. Nothing else in the studio does, and the board is
  drawn for a dark ground.
- **Restyling `/play`'s HUD, cards and sheet.** They are shared with the game, so a tester would
  judge a puzzle in a look no player sees.
- **Changing the shared board styles for the grid and the bench.** The game loads them; the
  studio lays its own over them instead.

## Consequences

- The shared board styles now have a second reader with its own values: a rule added to them
  for the game may need a line in `look.css` to sit right on the grid or the bench.
- A new piece of chrome picks teal or amber by what it means, not by which looks better.
- The page loads three more font families.
