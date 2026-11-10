import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_OVERLOAD_CONFIG,
  InvalidMoveError,
  OVERLOAD_DEF,
  OVERLOAD_FULL,
  advanceOverload,
  createOverloadGame,
  hashOverloadState,
  overloadChainSize,
  overloadChainValue,
  overloadHint,
  overloadNeighbours,
  overloadRefundFor,
  overloadRegenProgress,
  overloadStreakPercentAt,
  overloadTapIllegalReason,
  overloadViewString,
  reduceOverload,
  replayOverload,
  summarizeOverload,
  type OverloadCell,
  type OverloadConfig,
  type OverloadEvent,
  type OverloadMove,
  type OverloadState,
} from "../src/index.js";

const cfg = DEFAULT_OVERLOAD_CONFIG;

type Chain = Extract<OverloadEvent, { type: "chain" }>;

function chainOf(state: OverloadState): Chain | null {
  const e = state.lastMove?.events.find((x) => x.type === "chain");
  return e && e.type === "chain" ? e : null;
}

/** A move log from picked numbers: time passes by a picked gap, then a tap on a picked cell when one is held, a wait otherwise. */
function playRandom(seed: string, picks: readonly number[], config: OverloadConfig = cfg): { moves: OverloadMove[]; state: OverloadState } {
  let state = createOverloadGame(seed, config);
  const moves: OverloadMove[] = [];
  let tick = 0;
  for (let i = 0; i + 2 <= picks.length && !state.finished; i += 2) {
    tick = Math.min(config.maxTick, tick + (picks[i]! % 30));
    const cell = picks[i + 1]! % state.cells.length;
    const m: OverloadMove = overloadTapIllegalReason(state, cell, tick) === null ? { type: "tap", cell, tick } : { type: "wait", tick };
    moves.push(m);
    state = reduceOverload(state, m);
  }
  return { moves, state };
}

const picksArb = fc.array(fc.nat({ max: 10_000 }), { minLength: 0, maxLength: 240 });

/** A bank from rows of characters: a digit is a capacitor's charge, `a` to `d` a booster at 0 to 3. Deals nothing at random until a chain ends. */
function bank(rows: readonly string[], over: Partial<OverloadConfig> = {}): OverloadState {
  const config: OverloadConfig = { ...cfg, width: rows[0]!.length, height: rows.length, ...over };
  const base = createOverloadGame("t", config);
  let id = 1000;
  const cells: OverloadCell[] = rows
    .join("")
    .split("")
    .map((ch) => ("abcd".includes(ch) ? { id: id++, charge: "abcd".indexOf(ch), booster: true } : { id: id++, charge: Number(ch), booster: false }));
  return { ...base, cells, nextId: id };
}

const at = (s: OverloadState, col: number, row: number): number => row * s.config.width + col;
const tap = (s: OverloadState, cell: number, tick = s.tick): OverloadState => reduceOverload(s, { type: "tap", cell, tick });

describe("overload bank", () => {
  it("opens full, with charges of 0 to 3, a full hand and nothing scored", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const s = createOverloadGame(seed);
        expect(s.cells.length).toBe(cfg.width * cfg.height);
        expect(s.cells.every((c) => Number.isInteger(c.charge) && c.charge >= 0 && c.charge < OVERLOAD_FULL)).toBe(true);
        expect(new Set(s.cells.map((c) => c.id)).size).toBe(s.cells.length);
        expect(s.taps).toBe(cfg.startTaps);
        expect(s.score).toBe(0);
        expect(s.tick).toBe(0);
        expect(s.finished).toBe(false);
      }),
    );
  });

  it("deals fresh charges by the refill weights", () => {
    const only3: OverloadConfig = { ...cfg, refill: [0, 0, 0, 1], boosterPermille: 0 };
    expect(createOverloadGame("w", only3).cells.every((c) => c.charge === 3 && !c.booster)).toBe(true);
    const only0: OverloadConfig = { ...cfg, refill: [5, 0, 0, 0], boosterPermille: 500 };
    const s = createOverloadGame("w", only0);
    expect(s.cells.every((c) => c.charge === 0)).toBe(true);
    expect(s.cells.some((c) => c.booster)).toBe(true);
    expect(s.cells.some((c) => !c.booster)).toBe(true);
  });

  it("rejects an invalid config", () => {
    expect(() => createOverloadGame("x", { ...cfg, width: 2 })).toThrow();
    expect(() => createOverloadGame("x", { ...cfg, refill: [1, 1, 1] })).toThrow();
    expect(() => createOverloadGame("x", { ...cfg, refill: [0, 0, 0, 0] })).toThrow();
    expect(() => createOverloadGame("x", { ...cfg, streakPercent: [] })).toThrow();
    expect(() => createOverloadGame("x", { ...cfg, startTaps: cfg.tapCap + 1 })).toThrow();
    expect(() => createOverloadGame("x", { ...cfg, tapRegenTicks: 0 })).toThrow();
    expect(() => OVERLOAD_DEF.validateConfig(cfg)).not.toThrow();
  });
});

describe("overload determinism (ADR 0003)", () => {
  it("same seed and same move log give the same state and hash", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { moves, state } = playRandom(seed, picks);
        const replayed = replayOverload(seed, cfg, moves);
        expect(hashOverloadState(replayed)).toBe(hashOverloadState(state));
        expect(replayed).toEqual(state);
      }),
      { numRuns: 60 },
    );
  });

  it("different seeds deal different openings", () => {
    const hashes = new Set<string>();
    for (let i = 0; i < 50; i++) hashes.add(hashOverloadState(createOverloadGame(`seed-${i}`)));
    expect(hashes.size).toBe(50);
  });

  it("reduce never mutates its input", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { state } = playRandom(seed, picks.slice(0, 40));
        if (state.finished) return;
        const before = JSON.stringify(state);
        const cell = (picks[0] ?? 0) % state.cells.length;
        if (overloadTapIllegalReason(state, cell, state.tick) === null) tap(state, cell);
        reduceOverload(state, { type: "wait", tick: state.tick + 3 });
        advanceOverload(state, state.tick + 50);
        expect(JSON.stringify(state)).toBe(before);
      }),
      { numRuns: 60 },
    );
  });

  it("waits between the taps change nothing but the log: only the tick of a tap matters", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { moves, state } = playRandom(seed, picks.slice(0, 80));
        // The same taps with a wait logged before each, at a tick in the gap.
        let padded = createOverloadGame(seed);
        for (const m of moves) {
          if (padded.finished) break;
          const tick = m.tick ?? padded.tick;
          const mid = padded.tick + Math.floor((tick - padded.tick) / 2);
          padded = reduceOverload(padded, { type: "wait", tick: mid });
          if (!padded.finished) padded = reduceOverload(padded, m);
        }
        if (padded.finished !== state.finished) return; // the padded log reached the move cap first
        expect(padded.cells).toEqual(state.cells);
        expect({ score: padded.score, taps: padded.taps, regenFrom: padded.regenFrom, combo: padded.combo, tick: padded.tick }).toEqual({
          score: state.score,
          taps: state.taps,
          regenFrom: state.regenFrom,
          combo: state.combo,
          tick: state.tick,
        });
      }),
      { numRuns: 40 },
    );
  });

  it("advancing for display shows what a logged wait would hold", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, fc.nat({ max: 400 }), (seed, picks, gap) => {
        const { state } = playRandom(seed, picks.slice(0, 60));
        if (state.finished) return;
        const tick = Math.min(cfg.maxTick - 1, state.tick + gap);
        const shown = advanceOverload(state, tick);
        const logged = reduceOverload(state, { type: "wait", tick });
        expect({ tick: shown.tick, taps: shown.taps, regenFrom: shown.regenFrom }).toEqual({ tick: logged.tick, taps: logged.taps, regenFrom: logged.regenFrom });
        // Nothing but the clock moved, and the last move is still the one that was logged.
        expect(shown.cells).toBe(state.cells);
        expect(shown.lastMove).toBe(state.lastMove);
        expect(shown.eventSeq).toBe(state.eventSeq);
        expect(shown.logLength).toBe(state.logLength);
        expect(overloadRegenProgress(shown)).toBeGreaterThanOrEqual(0);
        expect(overloadRegenProgress(shown)).toBeLessThanOrEqual(cfg.tapRegenTicks);
      }),
      { numRuns: 60 },
    );
  });

  it("an end move finishes an untouched round at zero, with a tick or without", () => {
    for (const move of [{ type: "end", tick: 0 }, { type: "end" }, { type: "end", tick: 40 }] as const) {
      const s = reduceOverload(createOverloadGame("x"), move);
      expect(s.finished).toBe(true);
      expect(summarizeOverload(s)).toEqual({ score: 0, moves: 0, bestCombo: 0 });
      expect(() => reduceOverload(s, { type: "end", tick: s.tick })).toThrow(InvalidMoveError);
      expect(() => tap(s, 0)).toThrow(InvalidMoveError);
      expect(advanceOverload(s, s.tick + 10)).toBe(s);
    }
    expect(OVERLOAD_DEF.moveTimeMs?.({ type: "end" }, cfg)).toBe(0);
    expect(OVERLOAD_DEF.moveTimeMs?.({ type: "tap", cell: 0, tick: 12 }, cfg)).toBe(12 * cfg.tickMs);
  });
});

describe("overload rules", () => {
  it("keeps the bank's invariants after every move", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createOverloadGame(seed);
        let tick = 0;
        for (let i = 0; i + 2 <= picks.length && !state.finished; i += 2) {
          tick = Math.min(cfg.maxTick, tick + (picks[i]! % 30));
          const cell = picks[i + 1]! % state.cells.length;
          const legal = overloadTapIllegalReason(state, cell, tick) === null;
          const expected = legal ? overloadChainSize(state, cell) : 0;
          const next = reduceOverload(state, legal ? { type: "tap", cell, tick } : { type: "wait", tick });
          const r = next.lastMove!;
          // Full, every charge settled below 4, every id once, the hand within its cap.
          expect(next.cells.length).toBe(state.cells.length);
          expect(next.cells.every((c) => c.charge >= 0 && c.charge < OVERLOAD_FULL)).toBe(true);
          expect(new Set(next.cells.map((c) => c.id)).size).toBe(next.cells.length);
          expect(next.taps).toBeGreaterThanOrEqual(0);
          expect(next.taps).toBeLessThanOrEqual(cfg.tapCap);
          expect(next.score).toBe(state.score + r.points);
          expect(next.logLength).toBe(state.logLength + 1);
          // Events are numbered on from the last one, without a gap.
          r.events.forEach((e, k) => expect(e.seq).toBe(state.eventSeq + 1 + k));
          expect(next.eventSeq).toBe(state.eventSeq + r.events.length);
          const chain = chainOf(next);
          if (!legal) {
            expect(r.events).toEqual([]);
            expect(next.cells).toBe(state.cells);
          } else if (!chain) {
            // A priming tap: one charge on one capacitor, nothing else.
            expect(expected).toBe(0);
            expect(next.cells[cell]!.charge).toBe(state.cells[cell]!.charge + 1);
            next.cells.forEach((c, k) => k === cell || expect(c).toBe(state.cells[k]));
            expect(r.points).toBe(0);
            expect(next.combo).toBe(state.combo);
          } else {
            // The chain the engine promised, each capacitor bursting once, each spent one swapped.
            expect(chain.size).toBe(expected);
            const burst = chain.waves.flatMap((w) => w.bursts);
            expect(burst.length).toBe(chain.size);
            expect(new Set(burst).size).toBe(burst.length);
            expect(chain.waves[0]!.bursts).toEqual([cell]);
            expect(chain.fresh.map((f) => f.cell)).toEqual([...burst].sort((a, b) => a - b));
            for (const f of chain.fresh) expect(next.cells[f.cell]).toEqual({ id: f.id, charge: f.charge, booster: f.booster });
            const last = chain.waves[chain.waves.length - 1]!.charges;
            next.cells.forEach((c, k) => {
              if (burst.includes(k)) return;
              expect(c.id).toBe(state.cells[k]!.id);
              expect(c.booster).toBe(state.cells[k]!.booster);
              expect(c.charge).toBe(last[k]);
              expect(c.charge).toBeGreaterThanOrEqual(state.cells[k]!.charge);
            });
            expect(chain.base).toBe(overloadChainValue(cfg, chain.size));
            expect(chain.points).toBe(Math.floor((chain.base * chain.streakPercent) / 100));
            expect(chain.streakPercent).toBe(overloadStreakPercentAt(cfg, chain.streak));
            expect(r.points).toBe(chain.points);
            expect(next.combo).toBe(chain.streak);
          }
          state = next;
        }
      }),
      { numRuns: 60 },
    );
  });

  it("a tap adds one charge and costs one tap; a capacitor that reaches four bursts into its neighbours", () => {
    let s = bank(["000", "020", "000"]);
    s = tap(s, at(s, 1, 1));
    expect(overloadViewString(s.cells)).toBe("000030000");
    expect(s.taps).toBe(cfg.tapCap - 1);
    expect(s.moveCount).toBe(1);
    expect(s.lastMove!.events).toMatchObject([{ type: "tap", cell: 4, charge: 3, burst: false }]);
    expect(overloadChainSize(s, 4)).toBe(1);
    s = tap(s, at(s, 1, 1));
    const chain = chainOf(s)!;
    expect(chain.size).toBe(1);
    expect(chain.waves).toHaveLength(1);
    expect(chain.waves[0]!.charges).toEqual([0, 1, 0, 1, 0, 1, 0, 1, 0]);
    // The four neighbours keep the charge they were passed; the burst capacitor is a new one.
    expect([1, 3, 5, 7].map((c) => s.cells[c]!.charge)).toEqual([1, 1, 1, 1]);
    expect(s.cells[4]!.id).toBe(chain.fresh[0]!.id);
    expect(s.score).toBe(1);
    expect(s.chains).toBe(1);
  });

  it("charge passed off the edge is lost", () => {
    const s = tap(bank(["300", "000", "000"]), 0);
    expect(chainOf(s)!.waves[0]!.charges).toEqual([0, 1, 0, 1, 0, 0, 0, 0, 0]);
    expect(overloadNeighbours(s.config, 0)).toEqual([1, 3]);
    expect(overloadNeighbours(s.config, 4)).toEqual([1, 5, 7, 3]);
  });

  it("touching capacitors at three all go, wave by wave, and a two between two bursts goes too", () => {
    //  3 3 0     tap the corner: it bursts, then the 3 beside it, and the 2 below takes one from each.
    //  3 2 0
    //  0 0 0
    const s = bank(["330", "320", "000"]);
    expect(overloadChainSize(s, 0)).toBe(4);
    const next = tap(s, 0);
    const chain = chainOf(next)!;
    expect(chain.waves.map((w) => w.bursts)).toEqual([[0], [1, 3], [4]]);
    expect(chain.size).toBe(4);
    // A 2 that only one burst reaches is left at 3.
    const one = tap(bank(["320", "000", "000"]), 0);
    expect(chainOf(one)!.size).toBe(1);
    expect(one.cells[1]!.charge).toBe(3);
  });

  it("a capacitor bursts once in a chain: charge passed to a spent one is lost", () => {
    //  0 3 0     the centre bursts, then its four neighbours, each passing one back to the spent centre.
    //  3 3 3
    //  0 3 0
    const s = bank(["030", "333", "030"]);
    const next = tap(s, 4);
    const chain = chainOf(next)!;
    expect(chain.waves.map((w) => w.bursts)).toEqual([[4], [1, 3, 5, 7]]);
    expect(chain.size).toBe(5);
    // The corners took one from each of two neighbours and did not burst.
    expect(chain.waves[1]!.charges).toEqual([2, 0, 2, 0, 0, 0, 2, 0, 2]);
    // A chain is never longer than the bank, even when every capacitor is full.
    const all = tap(bank(["333", "333", "333"]), 4);
    expect(chainOf(all)!.size).toBe(9);
  });

  it("a booster passes two charges to each neighbour, so it carries a chain through a two", () => {
    const plain = tap(bank(["320", "000", "000"]), 0);
    expect(chainOf(plain)!.size).toBe(1);
    const s = bank(["d20", "200", "000"]);
    const next = tap(s, 0);
    const chain = chainOf(next)!;
    expect(chain.waves[0]!.boosted).toEqual([0]);
    expect(chain.waves.map((w) => w.bursts)).toEqual([[0], [1, 3]]);
    expect(chain.size).toBe(3);
    // The 2s burst with the charge two neighbours would have passed; the booster is swapped like any other.
    expect(chain.fresh.map((f) => f.cell)).toEqual([0, 1, 3]);
  });

  it("a chain of n scores n times n, and n times the cap past it", () => {
    expect(overloadChainValue(cfg, 1)).toBe(1);
    expect(overloadChainValue(cfg, 5)).toBe(25);
    expect(overloadChainValue(cfg, 10)).toBe(100);
    expect(overloadChainValue(cfg, cfg.chainCap)).toBe(cfg.chainCap * cfg.chainCap);
    expect(overloadChainValue(cfg, cfg.chainCap + 5)).toBe((cfg.chainCap + 5) * cfg.chainCap);
    expect(overloadChainValue({ ...cfg, burstPoints: 3 }, 4)).toBe(48);
    const s = tap(bank(["333", "333", "333"], { chainCap: 4 }), 0);
    expect(chainOf(s)!.base).toBe(9 * 4);
  });

  it("long chains build the streak, a short one breaks it and a priming tap leaves it alone", () => {
    // Every fresh capacitor is a 3, so each tap sets off the whole bank: a chain of nine every time.
    const hot: Partial<OverloadConfig> = { refill: [0, 0, 0, 1], boosterPermille: 0, refundEvery: 0, tapCap: 12, startTaps: 12 };
    let s = bank(["333", "333", "333"], hot);
    s = tap(s, 0);
    expect(s.combo).toBe(1);
    expect(chainOf(s)!.streakPercent).toBe(cfg.streakPercent[0]);
    expect(chainOf(s)!.points).toBe(81);
    s = tap(s, 0);
    expect(s.combo).toBe(2);
    expect(chainOf(s)!.points).toBe(Math.floor((81 * cfg.streakPercent[1]!) / 100));
    expect(chainOf(s)!.brokeStreak).toBe(false);
    // A priming tap on a cold bank: nothing bursts, the streak stands.
    const cold = { ...s, cells: s.cells.map((c, k) => ({ ...c, charge: k === 8 ? 3 : 0 })) };
    const primed = tap(cold, 0);
    expect(primed.combo).toBe(2);
    expect(chainOf(primed)).toBeNull();
    // A chain of one is short: the streak is gone, and it scores at 100 percent.
    const broke = tap(primed, 8);
    expect(chainOf(broke)).toMatchObject({ size: 1, streak: 0, streakPercent: 100, brokeStreak: true, points: 1 });
    expect(broke.combo).toBe(0);
    expect(broke.bestCombo).toBe(2);
    expect(overloadStreakPercentAt(cfg, 0)).toBe(100);
    expect(overloadStreakPercentAt(cfg, 999)).toBe(cfg.streakPercent[cfg.streakPercent.length - 1]);
  });

  it("a chain gives a tap back for every refundEvery bursts, up to the hand's cap", () => {
    expect(overloadRefundFor(cfg, cfg.refundEvery - 1)).toBe(0);
    expect(overloadRefundFor(cfg, cfg.refundEvery)).toBe(1);
    expect(overloadRefundFor(cfg, cfg.refundEvery * 3 + 1)).toBe(3);
    expect(overloadRefundFor({ ...cfg, refundEvery: 0 }, 40)).toBe(0);
    // Nine bursts at four a tap: two back. From three held: one spent, two back.
    const s = { ...bank(["333", "333", "333"], { refundEvery: 4 }), taps: 3, regenFrom: 0 };
    const next = tap(s, 4);
    expect(chainOf(next)!.refund).toBe(2);
    expect(next.taps).toBe(4);
    expect(next.refunds).toBe(2);
    // From a full hand the tap spent leaves room for one only; a hand filled again stops counting.
    const full = tap(bank(["333", "333", "333"], { refundEvery: 4 }), 4, 7);
    expect(chainOf(full)!.refund).toBe(1);
    expect(full.taps).toBe(cfg.tapCap);
    expect(full.regenFrom).toBe(7);
    expect(overloadRegenProgress(full)).toBe(0);
  });

  it("taps come back on the clock, one every tapRegenTicks, and none is banked past the cap", () => {
    const R = cfg.tapRegenTicks;
    let s = bank(["000", "000", "000"]);
    // A full hand banks nothing however long it is held.
    s = reduceOverload(s, { type: "wait", tick: 10 * R });
    expect(s.taps).toBe(cfg.tapCap);
    // Spending from a full hand starts the count at that tick.
    s = tap(s, 0, 10 * R + 3);
    expect(s.taps).toBe(cfg.tapCap - 1);
    expect(s.regenFrom).toBe(10 * R + 3);
    s = tap(s, 0, 10 * R + 5);
    expect(s.taps).toBe(cfg.tapCap - 2);
    expect(overloadRegenProgress(advanceOverload(s, 10 * R + 3 + R - 1))).toBe(R - 1);
    expect(advanceOverload(s, 10 * R + 3 + R - 1).taps).toBe(cfg.tapCap - 2);
    expect(advanceOverload(s, 10 * R + 3 + R).taps).toBe(cfg.tapCap - 1);
    expect(advanceOverload(s, 10 * R + 3 + 2 * R).taps).toBe(cfg.tapCap);
    expect(advanceOverload(s, 10 * R + 3 + 9 * R).taps).toBe(cfg.tapCap);
    // A tap that comes back mid-count keeps the remainder for the next one.
    const later = reduceOverload(s, { type: "wait", tick: 10 * R + 3 + R + 4 });
    expect(later.taps).toBe(cfg.tapCap - 1);
    expect(overloadRegenProgress(later)).toBe(4);
  });

  it("refuses a tap with none held, a cell off the bank and a tick that goes backwards or past the round", () => {
    let s = bank(["000", "000", "000"], { startTaps: 1 });
    s = tap(s, 0, 5);
    expect(overloadTapIllegalReason(s, 1, 6)).toBe("no taps left");
    expect(() => tap(s, 1, 6)).toThrow(InvalidMoveError);
    // The tap that has come back by the move's tick may be spent on it.
    expect(overloadTapIllegalReason(s, 1, 5 + cfg.tapRegenTicks)).toBeNull();
    expect(tap(s, 1, 5 + cfg.tapRegenTicks).taps).toBe(0);
    expect(overloadTapIllegalReason(s, 99, 500)).toBe("no such capacitor");
    expect(() => tap(s, -1, 500)).toThrow(InvalidMoveError);
    expect(() => reduceOverload(s, { type: "wait", tick: 4 })).toThrow(InvalidMoveError);
    expect(() => reduceOverload(s, { type: "wait", tick: 5.5 })).toThrow(InvalidMoveError);
    expect(() => reduceOverload(s, { type: "wait", tick: cfg.maxTick + 1 })).toThrow(InvalidMoveError);
    expect(() => reduceOverload(s, { type: "wait" } as unknown as OverloadMove)).toThrow(InvalidMoveError);
    expect(() => reduceOverload(s, { type: "bogus", tick: 9 } as unknown as OverloadMove)).toThrow(InvalidMoveError);
  });

  it("the round is over at the last tick and at the move cap", () => {
    const s = createOverloadGame("cap");
    expect(reduceOverload(s, { type: "wait", tick: cfg.maxTick - 1 }).finished).toBe(false);
    expect(reduceOverload(s, { type: "wait", tick: cfg.maxTick }).finished).toBe(true);
    expect(advanceOverload(s, cfg.maxTick + 500).tick).toBe(cfg.maxTick);
    let capped = createOverloadGame("cap", { ...cfg, maxMoves: 2 });
    capped = reduceOverload(capped, { type: "wait", tick: 1 });
    expect(capped.finished).toBe(false);
    capped = tap(capped, 0, 2);
    expect(capped.finished).toBe(true);
    expect(OVERLOAD_DEF.maxMoves(cfg)).toBe(cfg.maxMoves);
  });

  it("the hint is the longest chain a tap sets off, or the priming tap that makes a longer one when that is too short for the streak", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { state } = playRandom(seed, picks.slice(0, 60));
        const sizes = state.cells.map((_, c) => overloadChainSize(state, c));
        const best = Math.max(...sizes);
        const h = overloadHint(state);
        if (!h) {
          expect(best).toBe(0);
          return;
        }
        expect(h.cell).toBeGreaterThanOrEqual(0);
        expect(h.cell).toBeLessThan(state.cells.length);
        if (!h.prime) {
          expect(h.size).toBe(best);
          expect(sizes[h.cell]).toBe(best);
        } else {
          // The priming tap sets nothing off, and after it some tap sets off more than any does now.
          expect(best).toBeLessThan(cfg.streakMin);
          expect(sizes[h.cell]).toBe(0);
          const cells = state.cells.map((c, k) => (k === h.cell ? { ...c, charge: c.charge + 1 } : c));
          const after = Math.max(...cells.map((_, c) => overloadChainSize({ ...state, cells }, c)));
          expect(after).toBeGreaterThan(best);
        }
      }),
      { numRuns: 40 },
    );
    // Two pairs of 3s with a 2 between them: no tap reaches four, priming the 2 joins them into five.
    const s = bank(["33233", "00000", "00000"]);
    expect(overloadHint(s)).toEqual({ cell: 2, size: 0, prime: true });
    expect(overloadHint(tap(s, 2))).toMatchObject({ size: 5, prime: false });
    // A long chain already there is the hint as it stands.
    expect(overloadHint(bank(["33330", "00000", "00000"]))).toMatchObject({ size: 4, prime: false });
    // A bank with nothing near a burst still names a tap to make.
    expect(overloadHint(bank(["000", "000", "000"]))).toBeNull();
    expect(overloadHint(bank(["000", "020", "000"]))).toEqual({ cell: 4, size: 0, prime: true });
  });

  it("the view string names every cell", () => {
    expect(overloadViewString(bank(["012", "3ab", "cd0"]).cells)).toBe("0123abcd0");
  });
});
