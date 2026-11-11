import { DEFLECTORS_DEF, advanceDeflectors, deflectorsHint, deflectorsOutlook, deflectorsTrace, type DeflectorsMove, type DeflectorsState } from "@openseas/engine";
import { harnessPuzzle, ticks } from "../puzzles.js";

/** The opening as the first volley is announced: what a seed probe looks at. */
const opening = (s: DeflectorsState): DeflectorsState => advanceDeflectors(s, s.config.openingTicks);

/** How many single flips would bring the first volley home. */
function joins(s: DeflectorsState): number {
  const at = opening(s);
  const volley = at.volley;
  if (!volley) return 0;
  let count = 0;
  at.mirrors.forEach((m, cell) => {
    if (m === 0) return;
    const flipped = at.mirrors.map((x, c) => (c === cell ? 3 - x : x));
    if (volley.beams.every((b) => deflectorsTrace(at.config, flipped, b.entry).out === b.exit)) count++;
  });
  return count;
}

/** What the bench needs to know about Deflectors: its seed probes. */
export const DEFLECTORS = harnessPuzzle(DEFLECTORS_DEF, {
  probes: [
    { id: "one_flip", test: (s) => joins(s) > 0 },
    { id: "long_best", test: (s) => (opening(s).volley?.best ?? 0) >= 100 },
    { id: "hard_start", test: (s) => joins(s) === 0 && deflectorsHint(opening(s)) !== null && deflectorsOutlook(opening(s))?.hits === 0 },
  ],
  // The board's count and its beams in flight are timed against the tick.
  ticked: ticks(advanceDeflectors, (tick): DeflectorsMove => ({ type: "wait", tick })),
  hints: true,
});
