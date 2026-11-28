// The Cooling page on the new engine is the shipped page with another engine behind it (ADR 0097). This holds
// what that engine hands the board, the whole state and the whole report of every move, to what the shipped
// engine hands it from the same board with the same luck to come.
import { COOLING_DEF, DEFAULT_COOLING_CONFIG, previewSwap, Special, type CoolingConfig, type CoolingState } from "@openseas/engine";
import { nextInt, seedFromString, start, type AnyMove, type NewPiece, type Round } from "@openseas/puzzle";
import cooling from "@openseas/puzzle/examples/cooling";
import { describe, expect, it } from "vitest";
import { COOLING_MIRROR, coolingSettings, coolingShown } from "../../src/rungs/mirror/cooling.js";
import { named } from "./named.js";

const SPECIALS: Record<number, string> = { [Special.Charge]: "charge", [Special.Magnet]: "magnet", [Special.Slag]: "slag" };
const pieceOf = (kind: number): NewPiece => (kind in SPECIALS ? { piece: SPECIALS[kind]! } : { piece: "kind", kind: kind + 1 });
const boardOf = (s: CoolingState): NewPiece[][] =>
  Array.from({ length: s.config.height }, (_, y) => Array.from({ length: s.config.width }, (_, x) => pieceOf(s.cells[(s.config.height - 1 - y) * s.config.width + x]!.kind)));

const CONFIGS: Record<string, CoolingConfig> = {
  "as shipped": { ...DEFAULT_COOLING_CONFIG, shipHeat: false },
  "few kinds, many specials": { ...DEFAULT_COOLING_CONFIG, shipHeat: false, pieceKinds: 4, specialChancePerMille: { charge: 60, magnet: 50, slag: 90 }, cascadeMultipliers: [1, 3, 5, 7], streakStepPercent: 25, streakMaxPercent: 225, streakGrace: 0 },
  // Aboard, the ship's heat comes in between swaps as heat moves, which the new engine takes as its signal `level`.
  "aboard, with the ship's heat": { ...DEFAULT_COOLING_CONFIG, shipHeat: true, specialChancePerMille: { charge: 12, magnet: 8, slag: 120 } },
};

describe("the Cooling board's state from the new engine, beside the shipped engine's", () => {
  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`is the same state and the same report after every move: ${name}`, () => {
      for (let seed = 1; seed <= 8; seed++) {
        let shipped = COOLING_DEF.create(`seed-${seed}`, config);
        const round = start(cooling, { seed, settings: coolingSettings(config), board: boardOf(shipped), streams: { rise: shipped.rng } }) as Round<AnyMove>;
        let mirror = coolingShown(round, config);
        const [a, b] = [named(new Map()), named(new Map())];
        expect(b(mirror)).toEqual(a(shipped));
        let picks = seedFromString(`picks-${seed}`);
        const pick = (n: number): number => {
          const r = nextInt(picks, n);
          picks = r.state;
          return r.value;
        };
        for (let m = 0; m < 100; m++) {
          if (config.shipHeat && pick(4) === 0) {
            const heat = { type: "heat", row: pick(config.height + 1) } as const;
            shipped = COOLING_DEF.reduce(shipped, heat);
            mirror = COOLING_MIRROR.reduce(mirror, heat);
            expect(b(mirror), `seed ${seed}, heat ${m + 1}`).toEqual(a(shipped));
            continue;
          }
          let col = pick(config.width - 1), row = pick(config.height);
          for (let t = 0; t < 40 && pick(4) > 0 && previewSwap(shipped, col, row).cells.length === 0; t++) (col = pick(config.width - 1)), (row = pick(config.height));
          shipped = COOLING_DEF.reduce(shipped, { type: "swap", col, row });
          mirror = COOLING_MIRROR.reduce(mirror, { type: "swap", col, row });
          expect(b(mirror), `seed ${seed}, move ${m + 1}`).toEqual(a(shipped));
        }
      }
    });
  }
});
