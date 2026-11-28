// A legacy board is drawn from the state its hand-written engine kept. To put the same board on the new
// engine, each mirror here plays a round on `@openseas/puzzle` and shows it in that old shape (ADR 0097).
// The round itself is held beside the state it was shown as, and never inside it.
import type { AnyMove, Round } from "@openseas/puzzle";

const ROUNDS = new WeakMap<object, Round<AnyMove>>();

/** Remembers the round a shown state was made from. */
export function held<S extends object>(state: S, round: Round<AnyMove>): S {
  ROUNDS.set(state, round);
  return state;
}

/** The round behind a shown state. A state that did not come from a mirror has none. */
export function roundOf(state: object): Round<AnyMove> {
  const round = ROUNDS.get(state);
  if (!round) throw new Error("this state was not dealt by the new engine");
  return round;
}
