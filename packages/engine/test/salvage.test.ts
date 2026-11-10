import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_SALVAGE_CONFIG,
  InvalidMoveError,
  SALVAGE_COUPLER,
  SALVAGE_CRATE,
  createSalvageGame,
  hashSalvageState,
  reduceSalvage,
  SALVAGE_DEF,
  replayLog,
  salvageCanClose,
  salvageCanExtend,
  salvageEnclosedCells,
  salvageFindLoop,
  salvageHasLine,
  salvageHint,
  salvageLineIllegalReason,
  salvageLineValue,
  salvageViewString,
  type SalvageConfig,
  type SalvageMove,
  type SalvagePiece,
  type SalvageState,
} from "../src/index.js";

const cfg = DEFAULT_SALVAGE_CONFIG;

/** A line the engine accepts, grown from a picked start by picked steps; sometimes closed when it can be. */
function randomLine(state: SalvageState, picks: readonly number[]): SalvageMove | null {
  const n = state.cells.length;
  const want = state.config.minLine + ((picks[1] ?? 0) % 5);
  for (let k = 0; k < n; k++) {
    const start = ((picks[0] ?? 0) + k) % n;
    if (state.cells[start]!.kind === SALVAGE_CRATE) continue;
    const cells = [start];
    for (let step = 0; cells.length < want; step++) {
      const options: number[] = [];
      for (let c = 0; c < n; c++) if (salvageCanExtend(state, cells, c)) options.push(c);
      if (options.length === 0) break;
      cells.push(options[(picks[2 + step] ?? step) % options.length]!);
    }
    if (cells.length < state.config.minLine) continue;
    return { type: "tether", cells, loop: (picks[0] ?? 0) % 3 === 0 && salvageCanClose(state, cells) };
  }
  return null;
}

function playRandom(seed: string, picks: readonly number[], config: SalvageConfig = cfg): { moves: SalvageMove[]; state: SalvageState } {
  let state = createSalvageGame(seed, config);
  const moves: SalvageMove[] = [];
  for (let i = 0; i + 8 <= picks.length && !state.finished; i += 8) {
    const m = randomLine(state, picks.slice(i, i + 8));
    if (!m) break;
    moves.push(m);
    state = reduceSalvage(state, m);
  }
  return { moves, state };
}

const picksArb = fc.array(fc.nat({ max: 10_000 }), { minLength: 0, maxLength: 240 });

/** A field from rows of characters: a digit is debris, `C` a crate, `W` a coupler. */
function field(rows: readonly string[], seed = "t"): SalvageState {
  const config: SalvageConfig = { ...cfg, width: rows[0]!.length, height: rows.length, startCrates: 0 };
  const base = createSalvageGame(seed, config);
  let id = 1000;
  const cells: SalvagePiece[] = rows
    .join("")
    .split("")
    .map((ch) => ({ id: id++, kind: ch === "C" ? SALVAGE_CRATE : ch === "W" ? SALVAGE_COUPLER : Number(ch) }));
  return { ...base, cells, nextId: id };
}

const at = (s: SalvageState, col: number, row: number): number => row * s.config.width + col;

describe("salvage field", () => {
  it("opens full, with the configured crates off the floor and a line to draw", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const s = createSalvageGame(seed);
        expect(s.cells.length).toBe(cfg.width * cfg.height);
        expect(s.cells.every((p) => p !== undefined && Number.isInteger(p.kind))).toBe(true);
        const crates = s.cells.flatMap((p, i) => (p.kind === SALVAGE_CRATE ? [i] : []));
        expect(crates.length).toBe(cfg.startCrates);
        for (const c of crates) expect(Math.floor(c / cfg.width)).toBeLessThan(cfg.height - 2);
        expect(salvageHasLine(cfg, s.cells)).toBe(true);
        expect(new Set(s.cells.map((p) => p.id)).size).toBe(s.cells.length);
        expect(s.score).toBe(0);
        expect(s.finished).toBe(false);
      }),
    );
  });

  it("rejects an invalid config", () => {
    expect(() => createSalvageGame("x", { ...cfg, kinds: 1 })).toThrow();
    expect(() => createSalvageGame("x", { ...cfg, startCrates: 5, maxCrates: 3 })).toThrow();
    expect(() => createSalvageGame("x", { ...cfg, streakPercent: [] })).toThrow();
  });
});

describe("salvage determinism (ADR 0003)", () => {
  it("same seed and same move log give the same state and hash", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { moves, state } = playRandom(seed, picks);
        const replayed = replayLog(SALVAGE_DEF, seed, cfg, moves).final;
        expect(hashSalvageState(replayed)).toBe(hashSalvageState(state));
        expect(replayed).toEqual(state);
      }),
      { numRuns: 60 },
    );
  });

  it("different seeds deal different openings", () => {
    const hashes = new Set<string>();
    for (let i = 0; i < 50; i++) hashes.add(hashSalvageState(createSalvageGame(`seed-${i}`)));
    expect(hashes.size).toBe(50);
  });

  it("reduce never mutates its input", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const state = createSalvageGame(seed);
        const before = JSON.stringify(state);
        const m = randomLine(state, picks);
        if (m) reduceSalvage(state, m);
        expect(JSON.stringify(state)).toBe(before);
      }),
      { numRuns: 60 },
    );
  });

  it("an end move finishes an untouched round at zero", () => {
    const s = reduceSalvage(createSalvageGame("x"), { type: "end" });
    expect(s.finished).toBe(true);
    expect({ score: s.score, moves: s.moveCount, bestCombo: s.bestCombo }).toEqual({ score: 0, moves: 0, bestCombo: 0 });
    expect(() => reduceSalvage(s, { type: "end" })).toThrow(InvalidMoveError);
  });
});

describe("salvage rules", () => {
  it("keeps the field's invariants after every haul", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createSalvageGame(seed);
        for (let i = 0; i + 8 <= picks.length; i += 8) {
          const m = randomLine(state, picks.slice(i, i + 8));
          if (!m) break;
          const next = reduceSalvage(state, m);
          const r = next.lastMove!;
          // Full, no piece twice, crates and couplers within their caps, no crate left on the floor.
          expect(next.cells.length).toBe(cfg.width * cfg.height);
          expect(new Set(next.cells.map((p) => p.id)).size).toBe(next.cells.length);
          expect(next.cells.filter((p) => p.kind === SALVAGE_CRATE).length).toBeLessThanOrEqual(cfg.maxCrates);
          expect(next.cells.filter((p) => p.kind === SALVAGE_COUPLER).length).toBeLessThanOrEqual(cfg.maxCouplers);
          for (let col = 0; col < cfg.width; col++) expect(next.cells[(cfg.height - 1) * cfg.width + col]!.kind).not.toBe(SALVAGE_CRATE);
          expect(salvageHasLine(cfg, next.cells)).toBe(true);
          // The score is what the report says, and never negative.
          expect(next.score).toBe(state.score + r.points);
          expect(r.points).toBe(r.haulPoints + r.rounds.reduce((a, x) => a + x.points, 0));
          expect(r.points).toBeGreaterThan(0);
          // A piece that survives keeps its id and kind; one that was hauled is gone.
          const gone = new Set([...r.line, ...r.enclosed, ...r.netted, ...r.rounds.flatMap((x) => x.floor)].map((h) => h.id));
          if (!r.shuffled) {
            for (const p of state.cells) {
              if (gone.has(p.id)) expect(next.cells.some((q) => q.id === p.id)).toBe(false);
              else expect(next.cells.find((q) => q.id === p.id)?.kind).toBe(p.kind);
            }
          }
          // The last round's field is the state's, unless the field was dealt again.
          if (!r.shuffled) expect(r.rounds[r.rounds.length - 1]!.cells).toEqual(next.cells);
          state = next;
        }
      }),
      { numRuns: 60 },
    );
  });

  it("a line of n scores n squared, and the pieces above fall into the gap", () => {
    const s = field(["0123", "1111", "2302", "3023"]);
    const next = reduceSalvage(s, { type: "tether", cells: [at(s, 0, 1), at(s, 1, 1), at(s, 2, 1), at(s, 3, 1)], loop: false });
    const r = next.lastMove!;
    expect(r.haulPoints).toBe(16);
    expect(r.loop).toBe(false);
    // The top row dropped one row; four new pieces drifted in above it.
    expect(next.cells.slice(4, 8).map((p) => p.kind)).toEqual([0, 1, 2, 3]);
    expect(r.rounds[0]!.falls.length).toBe(4);
    expect(r.rounds[0]!.spawned.length).toBe(4);
    expect(next.cells.slice(8).map((p) => p.kind)).toEqual(s.cells.slice(8).map((p) => p.kind));
  });

  it("lines run diagonally, and a coupler joins two kinds", () => {
    const s = field(["0123", "2031", "31W2", "2313"]);
    // 0 at (0,0), 0 at (1,1), then the coupler at (2,2), then a 3 at (3,3): two kinds through the coupler.
    const cells = [at(s, 0, 0), at(s, 1, 1), at(s, 2, 2), at(s, 3, 3)];
    expect(salvageLineIllegalReason(s, cells, false)).toBeNull();
    expect(reduceSalvage(s, { type: "tether", cells, loop: false }).lastMove!.haulPoints).toBe(16);
    // Without the coupler the kinds do not match.
    expect(salvageLineIllegalReason(s, [at(s, 0, 0), at(s, 1, 1), at(s, 2, 1)], false)).toBe("pieces do not match");
  });

  it("refuses lines that are short, broken, repeated, mismatched or through a crate", () => {
    const s = field(["0000", "0C11", "2222", "3333"]);
    const bad = (cells: number[], loop = false): void => {
      expect(() => reduceSalvage(s, { type: "tether", cells, loop })).toThrow(InvalidMoveError);
    };
    bad([0, 1]);
    bad([0, 1, 3]);
    bad([0, 1, 0]);
    bad([0, 1, 2, 6]);
    bad([0, 4, 5]);
    bad([0, 1, 99]);
    bad([0, 1, 2, 3], true);
    expect(() => reduceSalvage(s, { type: "bogus" } as unknown as SalvageMove)).toThrow(InvalidMoveError);
  });

  it("a closed loop nets every crate on the field, worth more together, and hauls the debris inside", () => {
    // A diamond of 1s round a 2, with crates elsewhere.
    const s = field(["C0100", "01210", "20102", "3C303", "23232"]);
    const cells = [at(s, 2, 0), at(s, 3, 1), at(s, 2, 2), at(s, 1, 1)];
    expect(salvageCanClose(s, cells)).toBe(true);
    expect(salvageEnclosedCells(s.config, cells)).toEqual([at(s, 2, 1)]);
    const open = salvageLineValue(s, cells, false);
    const closed = salvageLineValue(s, cells, true);
    expect(open).toMatchObject({ loop: false, base: 16, netted: [], enclosed: [] });
    expect(closed.loop).toBe(true);
    expect(closed.netted).toEqual([at(s, 0, 0), at(s, 1, 3)]);
    // 16 doubled for the loop, one piece inside, and two crates at 50 * 2 * 2.
    expect(closed.base).toBe(32 + cfg.enclosedPoints + cfg.crateLoopPoints * 4);
    const next = reduceSalvage(s, { type: "tether", cells, loop: true });
    expect(next.lastMove!.netted.length).toBe(2);
    expect(next.lastMove!.enclosed.map((h) => h.kind)).toEqual([2]);
    expect(next.cratesNetted).toBe(2);
    expect(next.loops).toBe(1);
    // One crate alone is worth a quarter of two together.
    const one = field(["C0100", "01210", "20102", "30303", "23232"]);
    expect(salvageLineValue(one, cells, true).base).toBe(32 + cfg.enclosedPoints + cfg.crateLoopPoints);
  });

  it("a loop needs loopMin pieces and touching, linkable ends", () => {
    const s = field(["0102", "1213", "0102", "3232"]);
    // Three in a corner touch end to end but are too few.
    expect(salvageCanClose(s, [at(s, 1, 0), at(s, 0, 1), at(s, 1, 2)])).toBe(false);
    // Four in a row do not touch end to end.
    const row = field(["1111", "0202", "3030", "2323"]);
    expect(salvageCanClose(row, [0, 1, 2, 3])).toBe(false);
    expect(salvageLineValue(row, [0, 1, 2, 3], true).loop).toBe(false);
  });

  it("a crate that sinks to the floor is taken for the floor price, in a round of its own in the same move", () => {
    // The crate sits one above the floor; hauling the piece under it lands it.
    const s = field(["2301", "0123", "3C12", "2000"]);
    const next = reduceSalvage(s, { type: "tether", cells: [at(s, 1, 3), at(s, 2, 3), at(s, 3, 3)], loop: false });
    const r = next.lastMove!;
    expect(r.rounds.length).toBe(2);
    expect(r.rounds[1]!.floor.map((h) => h.kind)).toEqual([SALVAGE_CRATE]);
    expect(r.points).toBe(9 + cfg.crateFloorPoints);
    expect(next.cratesFloor).toBe(1);
  });

  it("long lines build the streak, one short line is forgiven and a second breaks it", () => {
    const long = (s: SalvageState): SalvageMove => {
      const line = salvageHint(s);
      if (!line || line.length < cfg.streakMin) throw new Error("no long line");
      return { type: "tether", cells: line.slice(0, cfg.streakMin), loop: false };
    };
    const short = (s: SalvageState): SalvageMove => ({ type: "tether", cells: salvageHint(s)!.slice(0, 3), loop: false });
    // Find a seed whose opening allows two long lines running.
    for (let i = 0; i < 200; i++) {
      let s = createSalvageGame(`streak-${i}`);
      try {
        s = reduceSalvage(s, long(s));
        expect(s.combo).toBe(1);
        expect(s.lastMove!.streakPercent).toBe(cfg.streakPercent[0]);
        s = reduceSalvage(s, long(s));
        expect(s.combo).toBe(2);
        expect(s.lastMove!.streakPercent).toBe(cfg.streakPercent[1]);
        expect(s.lastMove!.haulPoints).toBe(Math.floor((cfg.streakMin * cfg.streakMin * cfg.streakPercent[1]!) / 100));
        s = reduceSalvage(s, short(s));
        expect(s.combo).toBe(2);
        s = reduceSalvage(s, short(s));
        expect(s.combo).toBe(0);
        expect(s.bestCombo).toBe(2);
        return;
      } catch (e) {
        if (e instanceof Error && e.message === "no long line") continue;
        throw e;
      }
    }
    throw new Error("no seed allowed two long lines running");
  });

  it("deals the debris again when no line is left, keeping crates where they are", () => {
    // After this haul the field would hold no three of a kind touching; the engine deals it afresh.
    const config: SalvageConfig = { ...cfg, width: 3, height: 3, kinds: 8, startCrates: 0, cratePermille: 0, couplerPermille: 0 };
    let found = false;
    for (let i = 0; i < 400 && !found; i++) {
      let s = createSalvageGame(`dry-${i}`, config);
      for (let n = 0; n < 12; n++) {
        const line = salvageHint(s);
        if (!line) break;
        s = reduceSalvage(s, { type: "tether", cells: line.slice(0, 3), loop: false });
        expect(salvageHasLine(config, s.cells)).toBe(true);
        if (s.lastMove!.shuffled) found = true;
      }
    }
    expect(found).toBe(true);
  });

  it("the hint is a legal line, and the loop finder's line closes", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { state } = playRandom(seed, picks.slice(0, 40));
        const line = salvageHint(state);
        expect(line).not.toBeNull();
        expect(salvageLineIllegalReason(state, line!, false)).toBeNull();
        const loop = salvageFindLoop(state);
        if (loop) expect(salvageLineIllegalReason(state, loop, true)).toBeNull();
      }),
      { numRuns: 40 },
    );
  });

  it("stops at the move cap", () => {
    const config: SalvageConfig = { ...cfg, maxMoves: 2 };
    let s = createSalvageGame("cap", config);
    s = reduceSalvage(s, { type: "tether", cells: salvageHint(s)!.slice(0, 3), loop: false });
    expect(s.finished).toBe(false);
    s = reduceSalvage(s, { type: "tether", cells: salvageHint(s)!.slice(0, 3), loop: false });
    expect(s.finished).toBe(true);
  });

  it("the view string names every cell", () => {
    const s = field(["01C", "W23", "104"]);
    expect(salvageViewString(s.cells)).toBe("01CW23104");
  });
});
