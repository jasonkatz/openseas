import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  ASSEMBLY_CABLE,
  ASSEMBLY_CORE,
  ASSEMBLY_GIRDER,
  ASSEMBLY_PANEL,
  ASSEMBLY_SHAPES,
  ASSEMBLY_STRUT,
  DEFAULT_ASSEMBLY_CONFIG,
  InvalidMoveError,
  assemblyFitIllegalReason,
  assemblyFitPoints,
  assemblyFitValue,
  assemblyHint,
  assemblyLegalFits,
  assemblyLegalSwaps,
  assemblySwapIllegalReason,
  assemblyTrayString,
  assemblyViewString,
  createAssemblyGame,
  hashAssemblyState,
  reduceAssembly,
  replayAssembly,
  summarizeAssembly,
  validateAssemblyConfig,
  type AssemblyBlueprint,
  type AssemblyConfig,
  type AssemblyMove,
  type AssemblyPiece,
  type AssemblyState,
} from "../src/index.js";

const cfg = DEFAULT_ASSEMBLY_CONFIG;

/** A legal move picked from the bay: a fit when `pick` says so and one exists, a swap otherwise. */
function randomMove(state: AssemblyState, pick: number): AssemblyMove | null {
  const fits = assemblyLegalFits(state);
  if (fits.length > 0 && pick % 3 === 0) {
    const f = fits[pick % fits.length]!;
    return { type: "fit", slot: f.slot, cell: f.cell };
  }
  const swaps = assemblyLegalSwaps(state);
  if (swaps.length === 0) return null;
  const s = swaps[pick % swaps.length]!;
  return { type: "swap", a: s.a, b: s.b };
}

function playRandom(seed: string, picks: readonly number[], config: AssemblyConfig = cfg): { moves: AssemblyMove[]; state: AssemblyState } {
  let state = createAssemblyGame(seed, config);
  const moves: AssemblyMove[] = [];
  for (const p of picks) {
    if (state.finished) break;
    const m = randomMove(state, p);
    if (!m) break;
    moves.push(m);
    state = reduceAssembly(state, m);
  }
  return { moves, state };
}

const picksArb = fc.array(fc.nat({ max: 10_000 }), { minLength: 0, maxLength: 40 });

/** A bay from rows of characters: a digit is a part of that kind, `@` a core. */
function bay(rows: readonly string[], tray: readonly AssemblyBlueprint[] = [], over: Partial<AssemblyConfig> = {}): AssemblyState {
  const config: AssemblyConfig = { ...cfg, width: rows[0]!.length, height: rows.length, startCores: 0, corePermille: 0, ...over };
  const base = createAssemblyGame("t", config);
  let id = 1000;
  const cells: AssemblyPiece[] = rows
    .join("")
    .split("")
    .map((ch): AssemblyPiece => ({ id: id++, kind: ch === "@" ? ASSEMBLY_CORE : Number(ch) }));
  return { ...base, cells, tray: tray.length ? tray : base.tray, nextId: id };
}

/** A blueprint from rows: a digit asks for that kind, `.` is no part. */
function print(rows: readonly string[], id = 500): AssemblyBlueprint {
  const parts: Array<{ dc: number; dr: number; kind: number }> = [];
  rows.forEach((line, dr) => {
    for (let dc = 0; dc < line.length; dc++) if (line[dc] !== ".") parts.push({ dc, dr, kind: Number(line[dc]) });
  });
  return { id, shape: 0, width: rows[0]!.length, height: rows.length, parts };
}

describe("assembly determinism (ADR 0003)", () => {
  it("replay equals play", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { moves, state } = playRandom(seed, picks);
        expect(hashAssemblyState(replayAssembly(seed, cfg, moves))).toBe(hashAssemblyState(state));
      }),
      { numRuns: 60 },
    );
  });

  it("reduce never mutates its input", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createAssemblyGame(seed, cfg);
        for (const p of picks) {
          const m = randomMove(state, p);
          if (!m) break;
          const before = JSON.stringify(state);
          const next = reduceAssembly(state, m);
          expect(JSON.stringify(state)).toBe(before);
          state = next;
        }
      }),
      { numRuns: 40 },
    );
  });

  it("different seeds deal different bays", () => {
    const hashes = new Set<string>();
    for (let i = 0; i < 20; i++) hashes.add(hashAssemblyState(createAssemblyGame(`seed-${i}`, cfg)));
    expect(hashes.size).toBe(20);
  });

  it("an untouched round ends at nothing", () => {
    const s = reduceAssembly(createAssemblyGame("x", cfg), { type: "end" });
    expect(s.finished).toBe(true);
    expect(summarizeAssembly(s)).toEqual({ score: 0, moves: 0, bestCombo: 0 });
  });

  it("the draws keep to their own streams: the tray's blueprints do not depend on which fits were made", () => {
    // Two rounds on one seed that make different fits still draw the same next blueprints in turn.
    const seed = "streams";
    const a = createAssemblyGame(seed, cfg);
    const fits = assemblyLegalFits(a);
    if (fits.length < 2) return;
    const one = reduceAssembly(a, { type: "fit", ...fits[0]! });
    const two = reduceAssembly(a, { type: "fit", ...fits[fits.length - 1]! });
    expect(one.lastMove!.fit!.next.parts).toEqual(two.lastMove!.fit!.next.parts);
  });
});

describe("assembly deal", () => {
  it("opens full, with the opening cores, a full tray and a fit within one swap", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const s = createAssemblyGame(seed, cfg);
        expect(s.cells).toHaveLength(cfg.width * cfg.height);
        expect(s.cells.filter((p) => p.kind === ASSEMBLY_CORE)).toHaveLength(cfg.startCores);
        expect(s.tray).toHaveLength(cfg.traySize);
        const now = assemblyLegalFits(s).length > 0;
        const soon = assemblyLegalSwaps(s).some((m) => assemblyLegalFits(reduceAssembly(s, { type: "swap", ...m })).length > 0);
        expect(now || soon).toBe(true);
      }),
      { numRuns: 80 },
    );
  });

  it("every shape has three to five parts and fits a four by four box", () => {
    for (const s of ASSEMBLY_SHAPES) {
      expect(s.cells.length).toBeGreaterThanOrEqual(3);
      expect(s.cells.length).toBeLessThanOrEqual(5);
      expect(s.width).toBeLessThanOrEqual(4);
      expect(s.height).toBeLessThanOrEqual(4);
      for (const c of s.cells) expect(c.dc < s.width && c.dr < s.height).toBe(true);
    }
  });

  it("refuses a config out of bounds", () => {
    expect(() => validateAssemblyConfig(cfg)).not.toThrow();
    expect(() => validateAssemblyConfig({ ...cfg, kindWeights: [10, 0, 0, 0] })).toThrow();
    expect(() => validateAssemblyConfig({ ...cfg, kindWeights: [1, 1, 1] })).toThrow();
    expect(() => validateAssemblyConfig({ ...cfg, startCores: 4, maxCores: 3 })).toThrow();
    expect(() => validateAssemblyConfig({ ...cfg, chainCap: 0 })).toThrow();
    expect(() => validateAssemblyConfig({ ...cfg, sizeWeights: [0, 0, 0] })).toThrow();
  });
});

describe("assembly swaps: each part moves its own way", () => {
  // Row 0: girder strut cable panel; row 1: panel panel panel panel; and a core.
  const s = bay(["1230", "0000", "00@0", "0000"]);
  const at = (col: number, row: number): number => row * 4 + col;

  it("a girder swaps sideways, not up or down", () => {
    expect(assemblySwapIllegalReason(s, at(0, 0), at(1, 0))).toBeNull();
    expect(assemblySwapIllegalReason(s, at(0, 0), at(0, 1))).toBe("neither part moves that way");
  });

  it("a strut swaps up or down, and sideways only with a part that moves sideways", () => {
    expect(assemblySwapIllegalReason(s, at(1, 0), at(1, 1))).toBeNull();
    expect(assemblySwapIllegalReason(s, at(1, 0), at(2, 0))).toBe("neither part moves that way");
    expect(assemblySwapIllegalReason(s, at(1, 0), at(0, 0))).toBeNull();
  });

  it("a cable swaps corner to corner", () => {
    expect(assemblySwapIllegalReason(s, at(2, 0), at(1, 1))).toBeNull();
    expect(assemblySwapIllegalReason(s, at(2, 0), at(3, 1))).toBeNull();
    expect(assemblySwapIllegalReason(s, at(2, 0), at(2, 1))).toBe("neither part moves that way");
  });

  it("panels never swap with each other, a core never moves, and only neighbours swap", () => {
    expect(assemblySwapIllegalReason(s, at(0, 1), at(1, 1))).toBe("the same part");
    expect(assemblySwapIllegalReason(s, at(3, 0), at(3, 1))).toBe("the same part");
    expect(assemblySwapIllegalReason(s, at(2, 2), at(2, 1))).toBe("a core never moves");
    expect(assemblySwapIllegalReason(s, at(0, 0), at(2, 0))).toBe("not neighbours");
  });

  it("a swap trades the two parts, scores nothing and ends the chain", () => {
    const chained = { ...s, chain: 3 };
    const next = reduceAssembly(chained, { type: "swap", a: at(0, 0), b: at(1, 0) });
    expect(next.cells[at(0, 0)]!.kind).toBe(ASSEMBLY_STRUT);
    expect(next.cells[at(1, 0)]!.kind).toBe(ASSEMBLY_GIRDER);
    expect(next.score).toBe(0);
    expect(next.chain).toBe(0);
    expect(next.lastMove!.chainEnded).toBe(3);
    expect(() => reduceAssembly(s, { type: "swap", a: at(0, 0), b: at(0, 1) })).toThrow(InvalidMoveError);
  });
});

describe("assembly fits", () => {
  const ell = print(["12", "3."]);

  it("a blueprint fits where every part matches, a core standing for any", () => {
    const s = bay(["1200", "3000", "0000", "0000"], [ell]);
    expect(assemblyFitIllegalReason(s, 0, 0)).toBeNull();
    expect(assemblyFitIllegalReason(s, 0, 1)).toBe("the parts do not match");
    expect(assemblyFitIllegalReason(s, 0, 3)).toBe("it does not fit in the bay");
    const cored = bay(["1@00", "3000", "0000", "0000"], [ell]);
    expect(assemblyFitIllegalReason(cored, 0, 0)).toBeNull();
  });

  it("a fit takes its parts, scores (n - 2) by its place, and new parts appear where they were", () => {
    const s = bay(["0000", "1200", "3000", "0000"], [ell]);
    const next = reduceAssembly(s, { type: "fit", slot: 0, cell: 4 });
    const f = next.lastMove!.fit!;
    expect(f.place).toBe(1);
    expect(f.points).toBe(cfg.fitPoints * 1);
    expect(next.score).toBe(cfg.fitPoints);
    expect(next.cells).toHaveLength(16);
    // New parts in the three cells taken, in reading order; every other part where it was.
    expect(f.spawned.map((p) => p.cell)).toEqual([4, 5, 8]);
    for (const p of f.spawned) expect(next.cells[p.cell]!.id).toBe(p.id);
    s.cells.forEach((p, c) => {
      if (![4, 5, 8].includes(c)) expect(next.cells[c]).toBe(p);
    });
    expect(next.tray[0]!.id).not.toBe(ell.id);
    expect(next.chain).toBe(1);
    expect(next.fits).toBe(1);
  });

  it("fits in a chain pay more by their place, up to the cap", () => {
    expect(assemblyFitValue(cfg, 3, 0, 1)).toBe(10);
    expect(assemblyFitValue(cfg, 4, 0, 3)).toBe(60);
    expect(assemblyFitValue(cfg, 5, 1, 2)).toBe((30 + 10) * 2);
    expect(assemblyFitValue(cfg, 3, 0, 99)).toBe(10 * cfg.chainCap);
    expect(assemblyFitValue({ ...cfg, chainCap: 1 }, 4, 0, 5)).toBe(20);
    const s = { ...bay(["1200", "3000", "0000", "0000"], [ell]), chain: 2 };
    expect(assemblyFitPoints(s, 0, 0)).toBe(30);
    expect(reduceAssembly(s, { type: "fit", slot: 0, cell: 0 }).bestChain).toBe(3);
  });

  it("a core outside a fit stays where it is", () => {
    const line = print(["000"]);
    const s = bay(["1230", "1@11", "0000", "0000"], [line]);
    const next = reduceAssembly(s, { type: "fit", slot: 0, cell: 8 });
    expect(next.cells[5]).toBe(s.cells[5]);
    expect(next.cells[1]).toBe(s.cells[1]);
    expect(next.cells.every((p) => p !== undefined)).toBe(true);
  });

  it("a fit that takes a core scores it, and the core is gone", () => {
    const line = print(["000"]);
    const s = bay(["0@00", "1111", "1111", "1111"], [line]);
    const next = reduceAssembly(s, { type: "fit", slot: 0, cell: 0 });
    expect(next.lastMove!.fit!.cores).toBe(1);
    expect(next.score).toBe(cfg.fitPoints + cfg.corePoints);
    expect(next.coresUsed).toBe(1);
  });

  it("the view strings say what the board draws", () => {
    const s = bay(["12@0", "3000", "0000", "0000"], [ell]);
    expect(assemblyViewString(s.cells)).toBe("12@0300000000000");
    expect(assemblyTrayString([ell])).toBe("22123.");
  });
});

describe("assembly hint", () => {
  it("names the fit worth most, else a swap that opens a fit", () => {
    const ell = print(["12", "3."]);
    const fitNow = bay(["1200", "3000", "0000", "0000"], [ell]);
    expect(assemblyHint(fitNow)).toEqual({ type: "fit", slot: 0, cell: 0 });
    const oneOff = bay(["2100", "3000", "0000", "0000"], [ell]);
    const h = assemblyHint(oneOff);
    expect(h?.type).toBe("swap");
    expect(assemblyLegalFits(reduceAssembly(oneOff, h!)).length).toBeGreaterThan(0);
  });

  it("is null once the round is over", () => {
    expect(assemblyHint(reduceAssembly(createAssemblyGame("h", cfg), { type: "end" }))).toBeNull();
  });
});

describe("assembly kinds", () => {
  it("numbers its kinds as the board reads them", () => {
    expect([ASSEMBLY_PANEL, ASSEMBLY_GIRDER, ASSEMBLY_STRUT, ASSEMBLY_CABLE]).toEqual([0, 1, 2, 3]);
  });

  it("ends a round at maxMoves", () => {
    const { state } = playRandom("cap", [1, 2, 3, 4, 5, 6], { ...cfg, maxMoves: 3 });
    expect(state.finished).toBe(true);
    expect(state.moveCount).toBe(3);
  });
});
