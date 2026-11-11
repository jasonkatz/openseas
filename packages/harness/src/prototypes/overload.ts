import { OVERLOAD_DEF, advanceOverload, overloadChainSize, overloadHint, type OverloadMove, type OverloadState } from "@openseas/engine";
import { harnessPuzzle, ticks } from "../puzzles.js";

const longest = (s: OverloadState): number => s.cells.reduce((best, _, c) => Math.max(best, overloadChainSize(s, c)), 0);

/** What the bench needs to know about Overload: its seed probes. Its taps come back on the engine's clock (ADR 0015). */
export const OVERLOAD = harnessPuzzle(OVERLOAD_DEF, {
  probes: [
    { id: "long_chain", test: (s) => longest(s) >= 6 },
    { id: "join", test: (s) => overloadHint(s)?.prime === true },
    { id: "booster", test: (s) => s.cells.some((c) => c.booster) },
  ],
  ticked: ticks(advanceOverload, (tick): OverloadMove => ({ type: "wait", tick })),
  hints: true,
});
