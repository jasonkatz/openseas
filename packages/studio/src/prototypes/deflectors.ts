import { DEFLECTORS_DEF, advanceDeflectors, deflectorsHint, deflectorsOutlook, deflectorsTrace, type DeflectorsConfig, type DeflectorsMove, type DeflectorsState } from "@openseas/engine";
import { PUZZLE_CONFIG_SCHEMAS } from "@openseas/protocol";
import { content } from "@openseas/boards";
import type { HarnessPuzzle } from "../puzzles.js";
import { DEFLECTORS_PRESETS } from "../scenario/prototypes/deflectors.js";

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

/** What the studio needs to know about Deflectors: its content config and its starting points. */
export const DEFLECTORS: HarnessPuzzle<DeflectorsState, DeflectorsMove, DeflectorsConfig> = {
  id: "deflectors",
  def: DEFLECTORS_DEF,
  config: content.puzzles.deflectors.config,
  roundSeconds: content.puzzles.deflectors.roundSeconds,
  configSchema: PUZZLE_CONFIG_SCHEMAS.deflectors,
  presets: DEFLECTORS_PRESETS,
  // The board's count and its beams in flight are timed against the tick.
  locked: ["tickMs"],
  ticked: { tickMs: content.puzzles.deflectors.config.tickMs },
};
