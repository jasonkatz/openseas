import { reduceCooling, swapIllegalReason, type CoolingMove, type CoolingState } from "@openseas/engine";

/** A Cooling swap that scores if one exists, else the first legal swap: what an honest board plays. */
export function scoringMove(state: CoolingState): CoolingMove {
  let fallback: CoolingMove | null = null;
  for (let r = 0; r < state.config.height; r++) {
    for (let c = 0; c < state.config.width - 1; c++) {
      if (swapIllegalReason(state, c, r) !== null) continue;
      const move: CoolingMove = { type: "swap", col: c, row: r };
      if (reduceCooling(state, move).score > state.score) return move;
      fallback ??= move;
    }
  }
  if (!fallback) throw new Error("no legal move");
  return fallback;
}
