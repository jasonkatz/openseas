import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_SALVAGE_CONFIG,
  InvalidMoveError,
  SALVAGE_RUBBLE,
  SALVAGE_CRATE,
  createSalvageGame,
  hashSalvageState,
  reduceSalvage,
  replaySalvage,
  salvageCanClose,
  salvageCanExtend,
  salvageEnclosedCells,
  salvageFindLoop,
  salvageHasLine,
  salvageHint,
  salvageLineIllegalReason,
  salvageLineValue,
  salvageViewString,
  salvageVolatileValue,
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

/** A field from rows of characters: a digit is debris, `C` a crate, `R` rubble, a letter from `a` a volatile of that kind with `fuseFor` left. No order is posted. */
function field(rows: readonly string[], seed = "t", over: Partial<SalvageConfig> = {}, fuseFor = cfg.fuse): SalvageState {
  const config: SalvageConfig = { ...cfg, width: rows[0]!.length, height: rows.length, startCrates: 0, ...over };
  const base = createSalvageGame(seed, config);
  let id = 1000;
  const cells: SalvagePiece[] = rows
    .join("")
    .split("")
    .map((ch): SalvagePiece => {
      if (ch === "C") return { id: id++, kind: SALVAGE_CRATE };
      if (ch === "R") return { id: id++, kind: SALVAGE_RUBBLE };
      if (ch >= "a" && ch <= "h") return { id: id++, kind: ch.charCodeAt(0) - 97, fuse: fuseFor };
      return { id: id++, kind: Number(ch) };
    });
  return { ...base, cells, nextId: id, order: null };
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
        const replayed = replaySalvage(seed, cfg, moves);
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
          // Full, no piece twice, crates within their cap, no crate or rubble left on the floor.
          expect(next.cells.length).toBe(cfg.width * cfg.height);
          expect(new Set(next.cells.map((p) => p.id)).size).toBe(next.cells.length);
          expect(next.cells.filter((p) => p.kind === SALVAGE_CRATE).length).toBeLessThanOrEqual(cfg.maxCrates);
          for (let col = 0; col < cfg.width; col++) expect([SALVAGE_CRATE, SALVAGE_RUBBLE]).not.toContain(next.cells[(cfg.height - 1) * cfg.width + col]!.kind);
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
              else if (!r.blasts.some((b) => b.scorched.includes(state.cells.indexOf(p)))) expect(next.cells.find((q) => q.id === p.id)?.kind).toBe(p.kind);
              else expect(next.cells.find((q) => q.id === p.id)?.kind).toBe(SALVAGE_RUBBLE);
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

  it("lines run diagonally, never across kinds or through rubble", () => {
    const s = field(["0123", "2031", "31R2", "2313"]);
    expect(salvageLineIllegalReason(s, [at(s, 0, 0), at(s, 1, 1), at(s, 2, 2)], false)).toBe("rubble cannot be tethered");
    expect(salvageLineIllegalReason(s, [at(s, 0, 0), at(s, 1, 1), at(s, 2, 1)], false)).toBe("pieces do not match");
    const d = field(["0123", "2031", "3102", "2310"]);
    expect(salvageLineIllegalReason(d, [at(d, 0, 0), at(d, 1, 1), at(d, 2, 2), at(d, 3, 3)], false)).toBeNull();
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
    const config: SalvageConfig = { ...cfg, width: 3, height: 3, kinds: 8, startCrates: 0, cratePermille: 0, volatileEvery: 0, orderLength: 0 };
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

  it("a line of the order's kind, orderLength or longer, fills it for the bonus and posts another kind", () => {
    const over = { orderLength: 4 };
    const s0 = field(["0123", "1111", "2302", "3023"], "t", over);
    const s = { ...s0, order: { kind: 1 } };
    const line = [at(s, 0, 1), at(s, 1, 1), at(s, 2, 1), at(s, 3, 1)];
    expect(salvageLineValue(s, line, false)).toMatchObject({ fills: true, base: 16 + cfg.orderBonus });
    // Too short, or another kind: plain.
    expect(salvageLineValue(s, line.slice(0, 3), false)).toMatchObject({ fills: false, base: 9 });
    expect(salvageLineValue({ ...s0, order: { kind: 2 } }, line, false)).toMatchObject({ fills: false, base: 16 });
    const next = reduceSalvage(s, { type: "tether", cells: line, loop: false });
    expect(next.lastMove!.orderFilled).toBe(true);
    expect(next.ordersFilled).toBe(1);
    expect(next.order!.kind).not.toBe(1);
  });

  it("a game opens with an order, or none when orderLength is 0", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const s = createSalvageGame(seed);
        expect(s.order!.kind).toBeGreaterThanOrEqual(0);
        expect(s.order!.kind).toBeLessThan(cfg.kinds);
        expect(createSalvageGame(seed, { ...cfg, orderLength: 0 }).order).toBeNull();
      }),
      { numRuns: 30 },
    );
  });

  it("a volatile links as its kind, and defusing it pays more the longer it burned", () => {
    const fresh = field(["0123", "1b11", "2302", "3023"]);
    const late = field(["0123", "1b11", "2302", "3023"], "t", {}, 1);
    const line = [at(fresh, 0, 1), at(fresh, 1, 1), at(fresh, 2, 1), at(fresh, 3, 1)];
    expect(salvageLineIllegalReason(fresh, line, false)).toBeNull();
    expect(salvageVolatileValue(cfg, fresh.cells[at(fresh, 1, 1)]!)).toBe(cfg.volatilePoints);
    expect(salvageVolatileValue(cfg, late.cells[at(late, 1, 1)]!)).toBe(cfg.volatilePoints * cfg.fuse);
    const v = salvageLineValue(late, line, false);
    expect(v.defused).toEqual([at(late, 1, 1)]);
    expect(v.base).toBe(16 + cfg.volatilePoints * cfg.fuse);
    const next = reduceSalvage(late, { type: "tether", cells: line, loop: false });
    expect(next.defused).toBe(1);
    expect(next.lastMove!.blasts).toEqual([]);
  });

  it("a volatile left on the field burns down, then blows: it and the debris round it turn to rubble, crates untouched, and the streak breaks", () => {
    // A volatile 3 with one haul left in the corner, a crate beside it; the haul is the bottom row of 2s.
    const s0 = field(["a3C0", "3311", "0101", "2222"], "t", {}, 1);
    const s = { ...s0, combo: 3, grace: true };
    const next = reduceSalvage(s, { type: "tether", cells: [at(s, 0, 3), at(s, 1, 3), at(s, 2, 3), at(s, 3, 3)], loop: false });
    const r = next.lastMove!;
    expect(r.blasts.length).toBe(1);
    expect(r.blasts[0]!.cell).toBe(at(s, 0, 0));
    // The volatile, the 3 beside it and the two under it; the crate at (2,0) is not touched.
    expect(r.blasts[0]!.scorched).toEqual([at(s, 0, 0), at(s, 1, 0), at(s, 0, 1), at(s, 1, 1)]);
    expect(next.blasts).toBe(1);
    expect(next.combo).toBe(0);
    expect(next.cells.filter((p) => p.kind === SALVAGE_RUBBLE).length).toBe(4);
    // A volatile with more fuse just burns one.
    const slow = field(["a3C0", "3311", "0101", "2222"], "t", {}, 4);
    const after = reduceSalvage(slow, { type: "tether", cells: [at(slow, 0, 3), at(slow, 1, 3), at(slow, 2, 3), at(slow, 3, 3)], loop: false });
    expect(after.lastMove!.blasts).toEqual([]);
    expect(after.cells.find((p) => p.id === slow.cells[0]!.id)!.fuse).toBe(3);
  });

  it("rubble cannot be tethered; a loop clears it as enclosed, and the floor takes it for nothing", () => {
    const s = field(["01000", "1R101", "01020", "32323"], "t", { cratePermille: 0 });
    expect(salvageLineIllegalReason(s, [at(s, 1, 1), at(s, 2, 1), at(s, 3, 1)], false)).toBe("rubble cannot be tethered");
    const ring = [at(s, 1, 0), at(s, 2, 1), at(s, 1, 2), at(s, 0, 1)];
    const v = salvageLineValue(s, ring, true);
    expect(v.enclosed).toEqual([at(s, 1, 1)]);
    // Rubble on the floor row after a settle is taken off for no points.
    const low = field(["0123", "1230", "2R01", "3111"], "t", { cratePermille: 0 });
    const next = reduceSalvage(low, { type: "tether", cells: [at(low, 1, 3), at(low, 2, 3), at(low, 3, 3)], loop: false });
    const floor = next.lastMove!.rounds.flatMap((x) => x.floor);
    expect(floor.map((h) => h.kind)).toEqual([SALVAGE_RUBBLE]);
    expect(next.lastMove!.points).toBe(9);
  });

  it("a volatile drifts in every volatileEvery hauls, with its fuse lit", () => {
    const config: SalvageConfig = { ...cfg, volatileEvery: 2 };
    let s = createSalvageGame("vol", config);
    s = reduceSalvage(s, { type: "tether", cells: salvageHint(s)!.slice(0, 3), loop: false });
    expect(s.lastMove!.rounds[0]!.spawned.some((p) => p.fuse !== undefined)).toBe(false);
    s = reduceSalvage(s, { type: "tether", cells: salvageHint(s)!.slice(0, 3), loop: false });
    const lit = s.lastMove!.rounds[0]!.spawned.filter((p) => p.fuse !== undefined);
    expect(lit.length).toBe(1);
    expect(lit[0]!.fuse).toBe(config.fuse);
    expect(createSalvageGame("vol", { ...cfg, volatileEvery: 0 }).cells.some((p) => p.fuse !== undefined)).toBe(false);
  });

  it("the view string names every cell", () => {
    const s = field(["01C", "R23", "1d4"]);
    expect(salvageViewString(s.cells)).toBe("01CR231d4");
  });
});
