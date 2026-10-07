# Puzzle authoring guide

Each puzzle is two parts: a pure engine in `packages/shared` and a canvas
renderer in `packages/client`. Read `packages/shared/src/puzzles/types.ts`
and `packages/client/src/puzzles/registry.ts` first — they are the contract.

## Engine (`packages/shared/src/puzzles/<id>/`)

- `engine.ts` exports `State`, `Action`, and `const def: PuzzleDef<State, Action>`.
- `index.ts` does `import { registerPuzzle } from '../index'; import { def } from './engine'; registerPuzzle(def); export * from './engine';`
- `engine.test.ts` (vitest) covers: determinism (same seed + same log => deep-equal state),
  illegal actions are no-ops returning the same reference, scoring, game-over, and the
  core mechanic (matches/clears/paths etc.).
- State must extend `BasePuzzleState` (`rng`, `elapsedMs`, `over`) and be plain JSON
  (no classes, Maps, Sets, functions, undefined-heavy objects).
- NEVER call `Math.random` / `Date.now`. Draw randomness from `state.rng` via
  `rngNext/rngInt/rngPick/rngShuffle` in `packages/shared/src/rng.ts`, threading the
  returned rng back into the new state.
- `reduce` must be pure and return the **same reference** when the action is a no-op.
- `tick(state, dtMs)` advances time; `dtMs` is an integer, may be large (e.g. 5000) —
  loop internally in fixed steps if your mechanic depends on it so results are the same
  whether ticked in one 5000ms step or five 1000ms steps. State must be identical across
  split/merged ticks (this is what makes the server replay match the client).
- `score(state)` returns `{ points, performance (0..1), label: ratingLabel(performance) }`.
  `performance` should be a smoothed measure of recent play quality (use `ema`), rising
  with good play and decaying slowly while idle. Idle for 20s should noticeably drop it.
- Sessions last ~2–3 minutes (`config.durationMs`, default 150000). `over` becomes true
  at the limit or on a fail state (top-out / flooded).
- Keep `elapsedMs` updated in tick.

## Renderer (`packages/client/src/puzzles/<id>/`)

- `<Id>View.tsx` default-exports a React component matching `PuzzleViewProps<State, Action>`.
- `index.ts` does `import { registerPuzzleView } from '../registry'; import View from './<Id>View'; registerPuzzleView('<id>', View);`
- Draw on a `<canvas>` sized with `fitCanvas` from `packages/client/src/lib/canvas.ts`.
  Use `drawGem`, `PIECE_COLORS`, `roundRect`, `outlinedText`, `drawPanel` from there for a
  consistent look. Rendering happens every animation frame (`state` and `now` change per frame);
  do all drawing inside a `useLayoutEffect`/`useEffect` keyed on those props.
- Keep a small animation layer (tweens for falling/swapping/clearing) keyed off engine
  state changes so the board feels alive; animations must never block input. Target
  60fps; avoid allocating per frame where easy.
- Input: keyboard (arrow keys/WASD/space/Z/X as appropriate) AND mouse/touch. Only act
  when `focused` is true. Call `e.preventDefault()` for keys you consume. Attach
  keyboard listeners to `window` inside an effect and clean them up.
- Sound: `import { play } from '../../lib/audio'` and call `play('match')` etc. on events.
- Show a small HUD on the canvas: points, performance label, remaining time, and a one
  line hint of the controls. Everything must fit in `width`×`height` (min ~360×520, typical
  ~900×640) — compute a cell size from the available space.
- Style: warm, chunky, readable; deep navy background `#0d1b2a`, parchment accents
  `#f0d9a8`, brass `#c89b3c`. No generic grey UI.

## Testing

- `pnpm --filter @tidebound/shared test` and `pnpm --filter @tidebound/shared typecheck`.
- `pnpm --filter @tidebound/client typecheck` (ignore errors from files outside your folder).

Do not edit files outside your puzzle's two folders (except reading). The integrator
wires `import './<id>'` lines into the registries.
