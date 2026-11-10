# 0040. Every board runs through the kit: one host now, the core renderers one board at a time

Status: Accepted. Extends [0036](./0036-prototype-puzzles.md) and [0037](./0037-prototype-sprite-atlases.md),
whose kit was the prototypes' alone. Builds on [0019](./0019-boards-package-and-harness-bench.md).

## Context

`boards` holds two families of board. The eight prototypes are built on the kit (ADR 0036):
`KitBoard` owns the PixiJS application, the frame loop, tweens, effects and pointer plumbing, and
since ADR 0037 the atlas; a React hook, `useKitBoard`, hosted one in a page. The seven core boards
are older than the kit. Each has a hand-built renderer and a React wrapper, and every wrapper wrote
out again what `useKitBoard` already did: make the renderer on mount, wait for it, hand it the latest
state, listen for keys, tear it down, and pass each new state and setting on. That copy was about
280 of the 690 lines of core wrapper. All fifteen wrappers also kept their own ref to the latest
props, and ten wrote the same hints effect.

The copies had drifted. The kit ignores a key typed into a `<select>` and any key pressed with Ctrl,
Meta or Alt held, so the browser's shortcuts never reach a board. Of the core boards only Space
Battle ignored a `<select>`, and none ignored a modifier: Ctrl+D on Space Battle plotted a turn to
the right and kept the browser from bookmarking the page. The core wrappers also judged a renderer
ready by Pixi's own `app.renderer`, where the kit asks the renderer (`isReady`).

A board that is hosted, drawn and tested one way is cheaper to change and to prove than fifteen that
are nearly alike. The kit is the way the newer boards were built, and the smoke already drives every
board through the same attributes.

## Decision

1. **Every board, core and prototype, runs through the kit.** The core boards move onto it rather
   than living beside it, and the kit grows only the small hooks they need.
2. **First, one host for all fifteen.** `useBoardHost` in `boards/src/kit` replaces `useKitBoard`.
   It makes the renderer once, on mount, and hands `make` a ref to the latest props for its
   callbacks. Nothing reaches the renderer before it is ready; then it is handed the latest state,
   interactive switch, mark setting and hints, in that order, and after that each one as it changes.
   It owns the keyboard, with the kit's filter for every board, and the teardown. A wrapper keeps
   only what is its own: its labels from the message table, its `data-board`, and its extras (Space
   Battle's commit signal, plan attribute, arcs and turn clock; Swordfighting's remote boards;
   Navigation's markers; Deflectors' logged events).
3. **A renderer meets one small contract, `BoardRenderer<S>`:** `isReady`, `init`, `setState`,
   `setInteractive`, `setShowMarks`, `keyboard` and `destroy`, with `setHints` on a board that has
   hints and `keyUp` on a board that acts while a key is held. `KitBoard` meets it. The core
   renderers meet it with the least change and no change inside: an `isReady` getter on each; a
   `keyUp` on Engines and Swordfighting, whose space hurries while it is held; Cooling reads the move
   it plays from the state's `lastMove`, as the kit's renderers do, and waits for its webfont before
   it makes the canvas, so it is not ready until it can bake its labels.
4. **Then one core renderer a change.** Each following change moves one core board's renderer onto
   `KitBoard`'s lifecycle and is proven by the harness smoke that drives that board. The kit gains
   only what a core board needs and the prototypes can ignore. Expected so far: a wait before the
   canvas is made (Cooling's webfont), key-up (Engines, Swordfighting) and a way to opt out of hover
   (Space Battle). Anything larger is its own decision.

## Consequences

- Behaviour changes for the core boards: a key pressed with Ctrl, Meta or Alt held, or typed into a
  `<select>`, no longer reaches the board. No board binds a modified key, and no smoke test presses
  one. A key release still reaches the board with a modifier held, so a hurry always lets go.
- A board's wrapper is its labels, its `data-board` and its extras. The lifecycle cannot drift
  between boards because there is one.
- `CoolingBoard` loses its `report` prop: both pages passed the state's own `lastMove`.
- Until the seven have moved, the host serves two kinds of renderer through `BoardRenderer`. Once
  they have, `KitBoard` is the only kind, and the contract may fold into it.

## Alternatives considered

- **Move each core renderer onto `KitBoard` in one change.** Seven renderers of a thousand lines and
  more each cannot be reviewed or proven at once. The host can move first because it needs only the
  contract.
- **Keep two hosts.** The drift above is what that costs, and each fix would be made twice.
- **Hand a renderer its settings before it is ready, as the kit's host did.** Every setter would
  have to be safe before `init`; one rule, nothing before ready, is simpler to meet.
