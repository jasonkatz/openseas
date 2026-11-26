# The docs site

The docs site at docs.openseas.online (ADR 0038, ADR 0091). A static Vite and React app with no server and no
boards of its own. It has three areas.

| Area | Address | What it holds | Written in |
|---|---|---|---|
| Domain | `/domain` | What a puzzle is, apart from any world, a page for each idea, and the glossary | `docs/puzzles/DOMAIN.md` and `docs/puzzles/CONTEXT.md`, read at build time |
| API | `/api` | The puzzle, skin and theme objects field by field, and the rules SDK | `src/api/schema/*.ts` for the reference, `content/api/*.md` for the rest |
| Puzzle guides | `/guides` | One page per puzzle that takes a player from a first round to expert play | `src/guides/<id>.ts`, with pictures captured from the real boards on the studio's `/play` pages (ADR 0042) |

The site stands on its own: a reader needs nothing from this repository. No page in Domain or API names an
ADR or another file of the repo, and a test holds that.

```
pnpm --filter @openseas/docs dev        # the site, on :5175
pnpm --filter @openseas/docs capture    # re-take every guide's pictures (needs ffmpeg)
pnpm --filter @openseas/docs capture cooling   # one puzzle's
pnpm --filter @openseas/docs test       # every guide's shape, and its media on disk
pnpm --filter @openseas/docs test:smoke # Playwright: every page renders
```

## The domain pages

The domain guide stays one file, `docs/puzzles/DOMAIN.md`, and it is the only place its prose is written.
`src/domain/pages.ts` cuts it into pages: each page names the guide's `##` sections it shows, in order, with a
one-line lede and sometimes a figure. A link inside the guide to another of its headings becomes a link to the
page that heading is on.

- A new `##` section in the guide must be given to a page. `test/domain.test.ts` fails on a section no page
  shows, on one shown twice, and on a link that leads nowhere.
- The glossary page is built from `docs/puzzles/CONTEXT.md`: each `**Term**:` line is an entry, under its heading.

## The API reference

The puzzle, skin and theme objects are typed data in `src/api/schema/` (`puzzle.ts`, `skin.ts`, `theme.ts`), and
`src/pages/Reference.tsx` draws them: fields on the left, examples beside them.

| Address | Shows |
|---|---|
| `/api/<object>` | A top-level object: its own fields, and a link to each object that belongs to it |
| `/api/<object>/<key>` | One object that belongs to it, with everything nested inside defined on the same page |
| `/api/types` | The primitive values and the named types fields share |

- **A field** is `req`, `opt` or `when` (required in one case, refused in every other), with a type built from
  `src/api/schema/types.ts` and one description. An optional field says what leaving it out means (`absent`).
  What must hold between fields goes in its `only`, `never` and `must`, or in the page's `rules`.
- **An enum** lists every value with a sentence on what the value means. A value that is one of several forms
  is `variants` (told apart by a field) or `or` (told apart by its type).
- **A page** is an object directly under a top-level object. Add it with `page({...})` and place it in a group
  of the root. Nothing nested more deeply gets a page.
- **Every key is covered.** `test/reference.test.ts` reads the shapes in the domain guide and fails when a key
  is not in the reference, when an enum value has no explanation, and when a field is not typed down to a
  primitive value.
- **Every example is real.** Each example on a page, and the whole Paths puzzle and skin in
  `docs/puzzles/examples/`, are checked against the reference's own types (`src/api/schema/check.ts`).

## The other API pages

The overview, the walkthrough, Paths in full and the rules SDK are Markdown files in `content/api/`, listed in
`src/api/pages.ts`. Plain Markdown, with three additions.

| Written | Shows |
|---|---|
| A fence opened with `json title=swap.puzzle.json` | A code block with its file name. Add `tall` to let a long one scroll |
| A quote that starts `[!NOTE]` or `[!PREVIEW]` | A callout. A plain quote is an example |
| `<!-- figure: name -->` | One of the figures in `src/figures/` |

- **Every hook is covered.** `test/api.test.ts` fails when a hook the guide lists has no entry on the hooks
  page, and when a link on any page, or in the reference, leads nowhere.
- **A `json` fence must parse.** The whole Paths documents are read from `docs/puzzles/examples/`, not typed again.
- **The rules SDK is a design.** The engine that runs it is not built. The pages say what is settled, and
  `content/api/rules.md` lists what is not. When the engine lands, its own types replace the sketch on the
  context page.

Both areas keep the guides' voice: plain words, short sentences, sentence case, no dashes as punctuation.

## What a guide is made of

| File | What it holds |
|---|---|
| `src/guides/<id>.ts` | The guide: one `Guide` object (`src/guides/types.ts`). All of its prose. |
| `capture/<id>.capture.ts` | Plays the puzzle on its `/play` page and saves the guide's stills and clips. |
| `public/media/<id>/` | What the capture wrote: `<name>.webp` for a still; `<name>.mp4` and its poster `<name>.webp` for a clip. Committed. |

`src/guides/index.ts` lists every guide. `Cooling` is the worked example for all three files.

Every page has the same sections in the same order: what it is and what it is for, the rules,
the controls, how it scores, then **getting good** in four rungs (beginner, intermediate,
advanced, expert) and the common mistakes. The rungs are the point of the site. Each has a goal,
two to four tips and one thing to practise.

## Writing a guide

A guide is read in one sitting by someone who wants to play, not study. The type's limits
(`test/guides.test.ts` holds them) are a budget, not a target.

- **Find the strategy in the scoring.** Read the puzzle's design (`docs/puzzles/<id>.md`, or
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
idea that is easier to see than to read. A clip is short (aim for three to eight seconds, never much past ten) and about one thing.

A capture file is a Playwright file run against the studio (`playwright.capture.config.ts`);
`capture/lib.ts` is everything it is written with:

- `openLab(page, id, { seed, config, seconds, speed, paused })` opens a round on the puzzle's
  `/play` page: the board with nothing around it. The round is local, deterministic and needs no
  server. `config` takes overrides by path, as the studio's `c.<path>` links do; the server's
  schema must accept the result, or the page deals nothing.
- `stepClock`, `toggleClock` and `clockTick` drive a round opened with `paused`: a ticked puzzle is
  stepped a tick at a time so each act lands on the tick it was planned for. The studio has no
  control for this on screen; the page hands its round's clock to a script as
  `window.openseasRoundClock`.
- `findSeed(prefix, probe)` finds a seed whose game shows the idea. Plan with the engine in Node
  (`create<Id>Game`, `reduce<Id>`, the queries): search for the board or the short line of play
  that shows what the tip says, then play exactly that on the page. Never hard-code a seed found
  by hand: the search is the record of what the picture is meant to show.
- `still(page, id, name)` and `clip(page, id, name, play)` save the canvas. Pass `region` to show
  the board alone when the canvas is wider than it.
- `tapAt`, `dragThrough`, `glide` move a visible pointer so a clip shows the player's hand.
  `page.keyboard` works too; call `hidePointer` first. `settled` waits for the board's animation
  to land. `boardString`, `canvasAttr` and `boardGeom` read what the page publishes; the puzzle's
  smoke in `packages/studio/e2e/` shows how each board is driven.

Look at every picture after a capture. A clip that does not show what its caption says is worse
than none: `ffmpeg -i x.mp4 -vf "fps=3,scale=200:-1,tile=8x2" -frames:v 1 sheet.png` makes a
contact sheet.

Re-run a puzzle's capture when its board's art or rules change. The pictures are committed, so
the site builds without a browser.
