# Prototype puzzles

Eight new puzzles, built to be played and judged on the harness (ADR 0036). None is in the game.
Each is the game's own design: inspired by the feel of the original's puzzles, ported from none of
them. Each board draws the owner's sprites from its own atlas (ADR 0037), over code-drawn pieces
that stand in when the atlas is missing or a lab config goes past the sheet.

| Puzzle | The verb | Page | Design |
|---|---|---|---|
| Salvage | Drag a tether through matching debris; close it into a net | `/salvage` | [salvage.md](./salvage.md) |
| Overload | Tap a capacitor to charge it; a full one bursts into its neighbours | `/overload` | [overload.md](./overload.md) |
| Deflectors | Tap a mirror to flip it; route each beam to its exit | `/deflectors` | [deflectors.md](./deflectors.md) |
| Reactor | Swipe the whole board; fuse rods and push hot ones out a port | `/reactor` | [reactor.md](./reactor.md) |
| Scanner | Ping the fog and work out where the contacts are | `/scanner` | [scanner.md](./scanner.md) |
| Tug | Flick a pod; it slides until something stops it | `/tug` | [tug.md](./tug.md) |
| Racks | Move the top of one stack onto another; ship a full rack of one kind | `/racks` | [racks.md](./racks.md) |
| Cutting | Slice a slab along its grid; bank the pieces that hold one ore | `/cutting` | [cutting.md](./cutting.md) |

Each design file says what the puzzle is, how it scores, what is luck and what is skill, and what was
tuned and why. Keep it true: when a number or a rule changes, its design file changes in the same
commit.

## What a prototype is made of

One id, a lowercase word (`GLOSSARY.md` naming rule 2), and these files. `Salvage` is the worked
example for every one of them.

| File | What it holds |
|---|---|
| `packages/engine/src/<id>/types.ts` | Config, state, moves, the move report the board animates from. The header comment states the rules. |
| `packages/engine/src/<id>/reduce.ts` | `validateConfig`, `create<Id>Game`, `reduce<Id>`, `hash<Id>State`, `summarize<Id>`, `viewString`, and every query the board needs (is this legal, what is this worth, a hint). |
| `packages/engine/src/<id>/index.ts` | Re-exports, with queries prefixed by the id (`salvageCanExtend`), and `<ID>_DEF`. |
| `packages/engine/test/<id>.test.ts` | Property tests for determinism first (ADR 0003), then the rules. |
| `packages/protocol/src/<id>.ts` | `<Id>MoveSchema`, `<Id>ConfigSchema`. Bounds match the engine's validator; content loads its config through this schema (ADR 0039). |
| `packages/content/src/prototypes/<id>.ts` | `<Id>ContentSchema`: the base (round length, thresholds) and the protocol's config schema. |
| `packages/content/data/puzzles/<id>.json` | The config the server deals, the round length, the thresholds. |
| `packages/content/data/messages/prototypes/<id>.json` | Every string the puzzle shows. |
| `packages/boards/src/<id>/renderer.ts` | A `KitBoard` subclass: draws the state, plays the last move, reports input. |
| `packages/boards/src/sprites/<id>.webp` | The puzzle's atlas, with its frames in `frames.json` and its line in `atlas.ts`. |
| `packages/boards/src/<id>/<Id>Board.tsx` | The React wrapper: `useBoardHost`, the labels from the message table, `data-board`. |
| `packages/harness/src/pages/<Id>Practice.tsx` | The page: `usePracticePage`, `PracticeShell`, the board's handlers, HUD details, legend, result rows. |
| `packages/harness/src/prototypes/<id>.ts` | The bench entry, `harnessPuzzle(<ID>_DEF, …)`: seed probes, its tick clock if it ticks (`ticks`), whether it hints. Content gives the config and round length, `PRESETS` the presets. |
| `packages/harness/src/scenario/prototypes/<id>.ts` | Lab presets. Pure: no boards import. |
| `packages/harness/e2e/<id>.spec.ts` | The smoke: reach the page from home, play by key and by pointer, the canvas matches the engine. |
| `docs/prototypes/<id>.md` | The design. |

The lines that register a prototype are in `engine/src/registry.ts` and `engine/src/index.ts`,
`protocol/src/{common,puzzles,ws,index}.ts`, `content/src/prototypes/index.ts`,
`boards/src/index.ts`, and `harness/src/{App.tsx,pages/Home.tsx,scenario/presets.ts}`.

## Rules every prototype keeps

These are the project's rules (CLAUDE.md), said for a prototype.

1. **The engine is pure.** No clock, no `Math.random`, no I/O, no imports from outside `engine`.
   All randomness comes from the seeded PRNG (`prng.ts`), drawn in a fixed order. `pnpm --filter
   @openseas/engine lint` checks the banned words; it reads comments too, so do not write `Date`,
   `window` or `process.` in one.
2. **Same seed and same move log give the same state.** The first tests written are the
   determinism properties: replay equals play, `reduce` never mutates, different seeds differ.
3. **Every engine takes `{ type: "end" }`**, with or without a `tick`, as its first move, and an
   untouched round ends with `{ score: 0, moves: 0, bestCombo: 0 }`. The server's generic tests
   drive every engine that way.
4. **Time is data.** An engine that must move without input carries integer ticks in its moves
   (ADR 0015): a `tick` on every move, a `wait` move, an `advance<Id>(state, tick)` for display, a
   `tickMs` and a `maxTick` in config, and `moveTimeMs` on its `PuzzleDef`. The page drives it with
   `useTicked`. An engine with no clock of its own has none of that; the round's length is the
   page's and the server's.
5. **The board computes no score.** Every number it shows is an engine function's: what a line is
   worth, what a streak multiplies by. The engine exports those; the renderer calls them.
6. **Kinds read apart without color.** Use the kit's kinds (a silhouette each) and its pips for the
   mark setting. A special piece gets its own silhouette. A sprite keeps its kind's silhouette, and
   the pips go over it on a plate (`drawMark`).
7. **Every string is in the message table**, in the puzzle's own file. The renderer takes its
   labels as options; it never holds English.
8. **A lab round cannot run on a config the server would refuse.** The wire schema and the engine's
   validator bound the same fields; the scenario tests hold every preset to both.

## The board kit

`packages/boards/src/kit/`:

- `board.ts`: `KitBoard<S>`, the base class. It owns the PixiJS application, the frame loop, the
  pointer events and the test attributes. A renderer implements `build` (make display objects),
  `layout` (geometry, redraw from `this.state`), `onState` (show a state; play the last move when it
  follows from what is drawn, snap otherwise) and `view` (what is drawn, as the string
  `data-board` also holds). `bake` makes a texture once per layout. `Grid` lays out square cells.
  The core boards move onto it one at a time (ADR 0040), and the hooks they need are there for any
  board: `busy` stays true while a board animates outside the kit's tweens, so `onFrame` and
  `data-view` wait for it; `beforeCanvas` waits for something besides the atlas before the canvas
  is made (Cooling's webfont); `pointerLeave` takes a hover preview down.
- `tween.ts`: `Tweens`. `to`, `run`, `after`; `flush` finishes everything in order. `setState`
  flushes before every new state, and a layout does too, so an animation must leave the board
  exactly as a snap would: end every played move with a snap to the engine's state.
- `fx.ts`: `Fx`. `popup` (points), `say` (a callout), `burst`, `ring`, `beam`, `flash`, `shake`.
  Effects never hold the board back.
- `art.ts`: `KINDS`, `drawPiece`, `drawPips`, `drawMark`, `drawPanel`, `drawWell`, the `INK`
  palette. The pieces here are what a board draws without its atlas.
- `KindIcon.tsx`: a kind as an SVG, for legends. `SpriteIcon.tsx`: a frame of the atlas, for the
  same; `KindIcon` takes one as `sprite`.
- `useBoardHost.ts`: the React hook that hosts every board's renderer, core and prototype (ADR 0040),
  and `BoardRenderer`, what a renderer offers it. It owns the mount order, readiness, keys and teardown.

A ticked board is handed a new display state every tick. It overrides `keepsPlaying` to say so,
which stops the kit flushing its tweens ten times a second, and its `onState` plays only the events
it has not played yet: the engine numbers its events with a rising `seq`, as Navigation's does, and
the renderer remembers the last one it showed.

Sprites (ADR 0037): the kit loads the atlas named by the puzzle id. A renderer paints a frame with
`this.sprite(g, name, x, y, size)`, which returns false when the atlas or the frame is not there, so
every piece is written `this.sprite(...) || drawPiece(...)`. Frames are named for what the renderer
asks for (`spriteName("debris", kind)` is `debris-gold`). Keep everything exact in code: marks,
numerals, counts, outlines, hit areas. `sprites/README.md` says how the sheets are packed.

Sounds are `sfx` in `boards/src/audio.ts`; the renderer plays them at the moment the animation
shows the thing.

## Adding one, promoting one, removing one

- **Adding:** copy Salvage's files under a new id, register the id on the lines listed above, write
  the design file, and add a tile glyph in `Home.tsx`.
- **Promoting:** its own ADR and milestone. The puzzle gets a role (a station needs a `parScore`
  and station strings), moves from `PROTOTYPE_PUZZLE_IDS` to `CORE_PUZZLE_IDS`, its strings move to
  `en.json`.
- **Removing:** delete the files in the table and the lines that register the id, with its entry in
  `sprites/frames.json` and its line in `sprites/atlas.ts`.
