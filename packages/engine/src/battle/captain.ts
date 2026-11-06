/**
 * A captain that plots itself: the brigand's policy (ai.ts) sailed from the other side of the
 * board. The harness's voyage bench uses it to fight a sea battle unattended (ADR 0027); the game
 * never does, since there the captain is a pirate. It sees the fight as the brigand would, from a
 * mirrored state: the ships swapped, last turn's plans swapped, and its own knobs in the brigand's
 * place. The plan it returns is always one the reducer accepts for ship 0: it spends only ship 0's
 * tokens and loads, because in the mirror those are the brigand's.
 *
 * Every roll comes from the PRNG it is handed, never the fight's, so a fight sailed by this captain
 * replays from its move log like any other (ADR 0003).
 */

import type { PrngState } from "../prng.js";
import { chooseBrigandPlan } from "./ai.js";
import type { BattlePlan, BattleState } from "./types.js";

/** How the captain sails: the same knobs as a brigand tier, in percent. */
export interface CaptainSpec {
  /** Percent of planned shots actually fired, and how rarely a load is wasted on an empty sea. */
  readonly accuracy: number;
  /** Percent weight on closing and grappling over keeping out of the brigand's guns. */
  readonly aggression: number;
}

/** The fight as ship 0 would see it if it were the brigand. */
function mirrored(state: BattleState, spec: CaptainSpec): BattleState {
  const [mine, theirs] = state.ships;
  const last = state.lastTurn;
  return {
    ...state,
    config: { ...state.config, brigand: { ...state.config.brigand, accuracy: spec.accuracy, aggression: spec.aggression } },
    ships: [theirs, mine],
    lastTurn: last ? { ...last, plan: last.brigandPlan, brigandPlan: last.plan } : null,
  };
}

/** The captain's plot for the turn about to resolve. Spends only the PRNG it returns. */
export function chooseCaptainPlan(state: BattleState, spec: CaptainSpec, rng: PrngState): { plan: BattlePlan; rng: PrngState } {
  return chooseBrigandPlan(mirrored(state, spec), rng);
}
