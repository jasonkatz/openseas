/**
 * A captain that plots itself: the raider's policy (ai.ts) flew from the other side of the
 * board. The harness's voyage bench uses it to fight a space battle unattended (ADR 0027); the game
 * never does, since there the captain is a pirate. It sees the fight as the raider would, from a
 * mirrored state: the ships swapped, last turn's plans swapped, and its own knobs in the raider's
 * place. The plan it returns is always one the reducer accepts for ship 0: it spends only ship 0's
 * tokens and loads, because in the mirror those are the raider's.
 *
 * Every roll comes from the PRNG it is handed, never the fight's, so a fight flown by this captain
 * replays from its move log like any other (ADR 0003).
 */

import type { PrngState } from "../prng.js";
import { chooseRaiderPlan } from "./ai.js";
import type { BattlePlan, BattleState } from "./types.js";

/** How the captain flies: the same knobs as a raider tier, in percent. */
export interface CaptainSpec {
  /** Percent of planned shots actually fired, and how rarely a load is wasted on an empty space. */
  readonly accuracy: number;
  /** Percent weight on closing and grappling over keeping out of the raider's guns. */
  readonly aggression: number;
}

/** The fight as ship 0 would see it if it were the raider. */
function mirrored(state: BattleState, spec: CaptainSpec): BattleState {
  const [mine, theirs] = state.ships;
  const last = state.lastTurn;
  return {
    ...state,
    config: { ...state.config, raider: { ...state.config.raider, accuracy: spec.accuracy, aggression: spec.aggression } },
    ships: [theirs, mine],
    lastTurn: last ? { ...last, plan: last.raiderPlan, raiderPlan: last.plan } : null,
  };
}

/** The captain's plot for the turn about to resolve. Spends only the PRNG it returns. */
export function chooseCaptainPlan(state: BattleState, spec: CaptainSpec, rng: PrngState): { plan: BattlePlan; rng: PrngState } {
  return chooseRaiderPlan(mirrored(state, spec), rng);
}
