import type { PuzzleDef } from "@openseas/engine";
import { nextInt, seedFromString } from "@openseas/puzzle";
import { expect } from "vitest";
import { named } from "./named.js";

/** A stream of the test's own, to pick moves by: the same seed picks the same moves. */
export function picker(seed: string): (n: number) => number {
  let picks = seedFromString(`picks-${seed}`);
  return (n) => {
    const r = nextInt(picks, n);
    picks = r.state;
    return r.value;
  };
}

/**
 * Plays one round on the prototype's engine and on its mirror from the same seed, a move the picker chooses on the
 * prototype's state at a time, and holds what the mirror hands the board to what the prototype hands it, through
 * `apart` (what the two are written down to differ in, ADR 0099) and with ids compared as who they are. Returns
 * every state the prototype passed through, for the test to count the rules reached.
 */
export function beside<S extends { finished: boolean }, M, C>(opts: {
  def: PuzzleDef<S, M, C>;
  mirror: PuzzleDef<S, M, C>;
  seed: string;
  config: C;
  pickMove: (s: S, pick: (n: number) => number) => M | null;
  apart?: (s: S) => unknown;
  /** Checks of its own after each move, given both states. */
  also?: (shipped: S, mirror: S, at: string) => void;
  steps?: number;
}): S[] {
  const { def, mirror: m, seed, config } = opts;
  const apart = opts.apart ?? ((s: S) => s);
  const pick = picker(seed);
  let shipped = def.create(seed, config);
  let mirror = m.create(seed, config);
  const [a, b] = [named(new Map()), named(new Map())];
  expect(b(apart(mirror)), `${seed}, the deal`).toEqual(a(apart(shipped)));
  const seen = [shipped];
  for (let i = 0; i < (opts.steps ?? 400) && !shipped.finished; i++) {
    const move = opts.pickMove(shipped, pick);
    if (move === null) break;
    shipped = def.reduce(shipped, move);
    mirror = m.reduce(mirror, move);
    const at = `${seed}, move ${i + 1}: ${JSON.stringify(move)}`;
    expect(b(apart(mirror)), at).toEqual(a(apart(shipped)));
    expect(typeof m.hash(mirror), at).toBe("string");
    opts.also?.(shipped, mirror, at);
    seen.push(shipped);
  }
  return seen;
}
