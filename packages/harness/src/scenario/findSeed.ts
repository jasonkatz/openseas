import type { PuzzleDef } from "@openseas/engine";

/** Finds a seed whose opening state satisfies `probe`, trying `prefix-1`, `prefix-2`, ... up to `tries`. */
export function findSeed<S, M, C>(def: PuzzleDef<S, M, C>, config: C, probe: (state: S) => boolean, prefix: string, tries = 5000): string | null {
  for (let i = 1; i <= tries; i++) {
    const seed = `${prefix}-${i}`;
    if (probe(def.create(seed, config))) return seed;
  }
  return null;
}
