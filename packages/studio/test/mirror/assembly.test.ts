// The Assembly page on the new engine is the prototype's page with another engine behind it (ADR 0097, ADR 0099).
// This holds what that engine hands the board, the whole state and the report of every move, to what the
// prototype's engine hands it on the same seed.
import { ASSEMBLY_DEF, assemblyHint, assemblyLegalFits, assemblyLegalSwaps, DEFAULT_ASSEMBLY_CONFIG, type AssemblyConfig, type AssemblyMove, type AssemblyState } from "@openseas/engine";
import { describe, expect, it } from "vitest";
import { ASSEMBLY_MIRROR } from "../../src/rungs/mirror/assembly.js";
import { beside } from "./beside.js";

const CONFIGS: Record<string, AssemblyConfig> = {
  "as shipped": DEFAULT_ASSEMBLY_CONFIG,
  "many cores, a small tray": { ...DEFAULT_ASSEMBLY_CONFIG, width: 5, height: 5, traySize: 2, startCores: 4, corePermille: 300, maxCores: 5, chainCap: 3 },
};

/** The hint most of the time, a fit when one is there, else any swap. */
function pickMove(s: AssemblyState, pick: (n: number) => number): AssemblyMove | null {
  const fits = assemblyLegalFits(s);
  const swaps = assemblyLegalSwaps(s);
  const roll = pick(10);
  if (roll < 5) return assemblyHint(s);
  if (roll < 8 && fits.length > 0) return { type: "fit", ...fits[pick(fits.length)]! };
  return swaps.length > 0 ? { type: "swap", ...swaps[pick(swaps.length)]! } : null;
}

describe("the Assembly board's state from the new engine, beside the prototype's", () => {
  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`is the same state and the same report after every move: ${name}`, () => {
      const seen = { fits: 0, chains: 0, cores: 0, swaps: 0 };
      for (let seed = 1; seed <= 6; seed++) {
        for (const s of beside({ def: ASSEMBLY_DEF, mirror: ASSEMBLY_MIRROR, seed: `seed-${seed}`, config, pickMove, steps: 120 })) {
          const r = s.lastMove;
          if (r?.fit) seen.fits++, r.fit.place > 1 && seen.chains++, (seen.cores += r.fit.cores);
          if (r?.swap) seen.swaps++;
        }
      }
      expect(seen.fits).toBeGreaterThan(0);
      expect(seen.chains).toBeGreaterThan(0);
      expect(seen.cores).toBeGreaterThan(0);
      expect(seen.swaps).toBeGreaterThan(0);
    });
  }
});
