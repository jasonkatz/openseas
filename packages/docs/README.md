# Puzzle guides

The docs site (ADR 0038): one page per puzzle that takes a player from a first round to expert
play. A static Vite and React app with no server and no boards of its own. Its pictures are
captured from the real boards on the harness.

```
pnpm --filter @openseas/docs dev        # the site, on :5175
pnpm --filter @openseas/docs capture    # re-take every guide's pictures (needs ffmpeg)
pnpm --filter @openseas/docs capture cooling   # one puzzle's
pnpm --filter @openseas/docs test       # every guide's shape, and its media on disk
pnpm --filter @openseas/docs test:smoke # Playwright: every page renders
```

## What a guide is made of

| File | What it holds |
|---|---|
| `src/guides/<id>.ts` | The guide: one `Guide` object (`src/guides/types.ts`). All of its prose. |
| `capture/<id>.capture.ts` | Plays the puzzle on the harness and saves the guide's stills and clips. |
| `public/media/<id>/` | What the capture wrote: `<name>.webp` for a still; `<name>.mp4` and its poster `<name>.webp` for a clip. Committed. |

`src/guides/index.ts` lists every guide. `Cooling` is the worked example for all three files.

Every page has the same sections in the same order: what it is and what it is for, the rules,
the controls, how it scores, then **getting good** in four rungs (beginner, intermediate,
advanced, expert) and the common mistakes. The rungs are the point of the site. Each has a goal,
two to four tips and one thing to practise.

## Writing a guide

A guide is read in one sitting by someone who wants to play, not study. The type's limits
(`test/guides.test.ts` holds them) are a budget, not a target.

- **Find the strategy in the scoring.** Read the puzzle's design (`docs/DESIGN.md` 3.3, or
  `docs/prototypes/<id>.md`) and its engine (`packages/engine/src/<id>/`). What multiplies? What
  is luck and what is skill? What does a good player set up that a new player takes at once? Each
  rung teaches the next thing that pays, in the order a player can learn it.
- **Say what to do and why it pays.** "Leave the slag until two sit under the line: together they
  are worth 60, apart 30." Not "slag can be valuable".
- **Only true things.** Every rule, control and number in a guide must be what the engine and the
  board do today. Read the renderer for the controls (`packages/boards/src/<id>/renderer.ts`); do
  not guess them from another puzzle.
- **Numbers come from content.** Import `content` from `../content.js` and write
  `${content.puzzles.<id>.roundSeconds}` into the sentence. A constant that lives only in the
  engine is imported from `@openseas/engine` if it is exported; otherwise leave the number out
  or say it in words.
- **Plain words.** Short sentences, second person, present tense. `**bold**` is the only markup:
  use it for the one term a sentence introduces. No dashes as punctuation, no semicolons.
- **The game's words.** `docs/GLOSSARY.md` and the puzzle's message file
  (`packages/content/data/messages/`) name every piece. Use those names. Nothing from Puzzle
  Pirates (CLAUDE.md rule 3).
- **Theme.** `theme.setting` is what the puzzle is in the world: who you are, what you are doing
  with your hands. `theme.purpose` is what it does for the ship (DESIGN.md 3.4): for a prototype,
  which is in no ship yet, it is what the puzzle is trying out and what skill it asks for.

## Pictures

Five to eight per guide: the board (the hero), the basic move (with the rules), and one for each
idea that is easier to see than to read. A clip is three to eight seconds and about one thing.

A capture file is a Playwright file run against the harness (`playwright.capture.config.ts`);
`capture/lib.ts` is everything it is written with:

- `openLab(page, id, { seed, config, seconds, speed, paused })` opens a lab round. Lab rounds are
  local, deterministic and need no server. `config` takes overrides by path, as the harness's
  `c.<path>` links do; the server's schema must accept the result.
- `findSeed(prefix, probe)` finds a seed whose game shows the idea. Plan with the engine in Node
  (`create<Id>Game`, `reduce<Id>`, the queries): search for the board or the short line of play
  that shows what the tip says, then play exactly that on the page. Never hard-code a seed found
  by hand: the search is the record of what the picture is meant to show.
- `still(page, id, name)` and `clip(page, id, name, play)` save the canvas. Pass `region` to show
  the board alone when the canvas is wider than it.
- `tapAt`, `dragThrough`, `glide` move a visible pointer so a clip shows the player's hand.
  `page.keyboard` works too; call `hidePointer` first. `settled` waits for the board's animation
  to land. `boardString`, `canvasAttr` and `boardGeom` read what the page publishes; the puzzle's
  harness smoke (`packages/harness/e2e/`) shows how each board is driven.

Look at every picture after a capture. A clip that does not show what its caption says is worse
than none: `ffmpeg -i x.mp4 -vf "fps=3,scale=200:-1,tile=8x2" -frames:v 1 sheet.png` makes a
contact sheet.

Re-run a puzzle's capture when its board's art or rules change. The pictures are committed, so
the site builds without a browser.
