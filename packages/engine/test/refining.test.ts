import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_REFINING_CONFIG,
  InvalidMoveError,
  REFINING_CATALYST,
  REFINING_OIL,
  REFINING_SMOKE,
  REFINING_TAR,
  REFINING_VAPOUR,
  advanceRefining,
  createRefiningGame,
  hashRefiningState,
  reduceRefining,
  refiningColumn,
  refiningDrawValue,
  refiningGradeColumn,
  refiningHint,
  refiningLinked,
  refiningLinks,
  refiningSortedness,
  refiningSwapIllegalReason,
  refiningViewString,
  replayRefining,
  summarizeRefining,
  type RefiningConfig,
  type RefiningKind,
  type RefiningMove,
  type RefiningPiece,
  type RefiningState,
} from "../src/index.js";

const cfg = DEFAULT_REFINING_CONFIG;

/** A random legal move: mostly swaps, sometimes an early draw or a wait, the clock always going forward. */
function randomMove(state: RefiningState, pick: number): RefiningMove {
  const tick = Math.min(state.config.maxTick, state.tick + (pick % 13));
  const after = advanceRefining(state, tick);
  if (pick % 11 === 0) return { type: "draw", tick };
  if (pick % 7 === 0) return { type: "wait", tick };
  const ls = refiningLinks(after);
  if (ls.length === 0) return { type: "wait", tick };
  const l = ls[pick % ls.length]!;
  return { type: "swap", cell: l.cell, dir: l.dir, tick };
}

function playRandom(seed: string, picks: readonly number[], config: RefiningConfig = cfg): { moves: RefiningMove[]; state: RefiningState } {
  let state = createRefiningGame(seed, config);
  const moves: RefiningMove[] = [];
  for (const p of picks) {
    if (state.finished) break;
    const m = randomMove(state, p);
    moves.push(m);
    state = reduceRefining(state, m);
  }
  return { moves, state };
}

const picksArb = fc.array(fc.nat({ max: 10_000 }), { minLength: 0, maxLength: 60 });

/** A tower from rows of characters: v vapour, o oil, t tar, s smoke, * catalyst. */
function tower(rows: readonly string[], over: Partial<RefiningConfig> = {}, seed = "t"): RefiningState {
  const config: RefiningConfig = { ...cfg, width: rows[0]!.length, height: rows.length, ...over };
  const base = createRefiningGame(seed, config);
  let id = 1000;
  const map: Record<string, RefiningKind> = { v: REFINING_VAPOUR, o: REFINING_OIL, t: REFINING_TAR, s: REFINING_SMOKE, "*": REFINING_CATALYST };
  const cells: RefiningPiece[] = rows
    .join("")
    .split("")
    .map((ch) => ({ id: id++, kind: map[ch]! }));
  return { ...base, cells, nextId: id };
}

describe("refining tower", () => {
  it("opens full, nothing scored, the first draw a pulse away", () => {
    const s = createRefiningGame("open");
    expect(s.cells).toHaveLength(cfg.width * cfg.height);
    expect(new Set(s.cells.map((c) => c.id)).size).toBe(s.cells.length);
    expect(s.score).toBe(0);
    expect(s.nextDraw).toBe(cfg.pulseTicks);
    expect(s.cells.some((c) => c.kind === REFINING_SMOKE)).toBe(false);
  });

  it("deals the feed by its weights", () => {
    const config = { ...cfg, width: 10, height: 10, catalystPermille: 0 };
    let v = 0;
    let n = 0;
    for (let i = 0; i < 20; i++) {
      for (const c of createRefiningGame(`w${i}`, config).cells) {
        n++;
        if (c.kind === REFINING_VAPOUR) v++;
      }
    }
    expect(v / n).toBeGreaterThan(0.36);
    expect(v / n).toBeLessThan(0.48);
  });

  it("rejects an invalid config", () => {
    expect(() => createRefiningGame("x", { ...cfg, width: 2 })).toThrow();
    expect(() => createRefiningGame("x", { ...cfg, vapourPermille: 700, oilPermille: 400 })).toThrow();
    expect(() => createRefiningGame("x", { ...cfg, vapourPermille: 0 })).toThrow();
    expect(() => createRefiningGame("x", { ...cfg, runCap: 0 })).toThrow();
  });
});

describe("refining determinism (ADR 0003)", () => {
  it("same seed and same move log give the same state and hash", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { moves, state } = playRandom(seed, picks);
        const again = replayRefining(seed, cfg, moves);
        expect(hashRefiningState(again)).toBe(hashRefiningState(state));
        expect(again.cells).toEqual(state.cells);
        expect(again.score).toBe(state.score);
      }),
      { numRuns: 60 },
    );
  });

  it("different seeds deal different openings", () => {
    const views = new Set<string>();
    for (let i = 0; i < 20; i++) views.add(refiningViewString(createRefiningGame(`s${i}`).cells));
    expect(views.size).toBe(20);
  });

  it("reduce never mutates its input", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, fc.nat({ max: 10_000 }), (seed, picks, last) => {
        const { state } = playRandom(seed, picks);
        if (state.finished) return;
        const frozen = JSON.stringify(state);
        reduceRefining(state, randomMove(state, last));
        expect(JSON.stringify(state)).toBe(frozen);
      }),
      { numRuns: 40 },
    );
  });

  it("advancing for display shows what a logged wait would hold", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, fc.nat({ max: 400 }), (seed, picks, ahead) => {
        const { state } = playRandom(seed, picks);
        if (state.finished) return;
        const tick = Math.min(cfg.maxTick - 1, state.tick + ahead);
        if (tick < state.tick) return;
        const shown = advanceRefining(state, tick);
        const logged = reduceRefining(state, { type: "wait", tick });
        expect(shown.cells).toEqual(logged.cells);
        expect(shown.score).toBe(logged.score);
        expect(shown.eventSeq).toBe(logged.eventSeq);
        // The events the display gained are the ones the wait logs, by seq.
        const fresh = shown.events.filter((e) => e.seq > state.eventSeq).map((e) => e.seq);
        expect(fresh).toEqual(logged.events.map((e) => e.seq));
      }),
      { numRuns: 40 },
    );
  });

  it("the n-th feed is the same however the round is played", () => {
    const a = reduceRefining(createRefiningGame("feed"), { type: "draw", tick: 3 });
    const b = reduceRefining(reduceRefining(createRefiningGame("feed"), { type: "swap", ...refiningLinks(createRefiningGame("feed"))[0]!, tick: 10 }), { type: "wait", tick: cfg.pulseTicks });
    const freshA = a.events.find((e) => e.type === "draw");
    const freshB = b.events.find((e) => e.type === "draw");
    expect(freshA?.type === "draw" && freshA.fresh.map((p) => p.kind)).toEqual(freshB?.type === "draw" && freshB.fresh.map((p) => p.kind));
  });

  it("an end move finishes an untouched round at zero, with a tick or without", () => {
    for (const end of [{ type: "end" } as const, { type: "end", tick: 0 } as const]) {
      const s = reduceRefining(createRefiningGame("e"), end);
      expect(s.finished).toBe(true);
      expect(summarizeRefining(s)).toEqual({ score: 0, moves: 0, bestCombo: 0 });
    }
  });
});

describe("refining rules", () => {
  it("keeps the tower full, ids unique and the score at or above zero after every move", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createRefiningGame(seed);
        for (const p of picks) {
          if (state.finished) break;
          state = reduceRefining(state, randomMove(state, p));
          expect(state.cells).toHaveLength(cfg.width * cfg.height);
          expect(new Set(state.cells.map((c) => c.id)).size).toBe(state.cells.length);
          expect(state.score).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 40 },
    );
  });

  it("links follow the cycle vapour, oil, tar: the second is next after the first, and a catalyst links nothing", () => {
    expect(refiningLinked(REFINING_VAPOUR, REFINING_OIL)).toBe(true);
    expect(refiningLinked(REFINING_OIL, REFINING_TAR)).toBe(true);
    expect(refiningLinked(REFINING_TAR, REFINING_VAPOUR)).toBe(true);
    expect(refiningLinked(REFINING_TAR, REFINING_SMOKE)).toBe(true);
    expect(refiningLinked(REFINING_OIL, REFINING_VAPOUR)).toBe(false);
    expect(refiningLinked(REFINING_VAPOUR, REFINING_VAPOUR)).toBe(false);
    expect(refiningLinked(REFINING_CATALYST, REFINING_OIL)).toBe(false);
    expect(refiningLinked(REFINING_TAR, REFINING_CATALYST)).toBe(false);
  });

  it("a swap trades the two pieces, and cannot be undone straight away", () => {
    const s = tower(["vo*", "tt*", "***"]);
    const after = reduceRefining(s, { type: "swap", cell: 0, dir: "right", tick: 1 });
    expect(refiningViewString(after.cells)).toBe("ov*tt****");
    expect(refiningSwapIllegalReason(after, 0, "right")).toBe("not linked");
    // Vapour over tar: not linked; tar over vapour would be.
    expect(refiningSwapIllegalReason(after, 1, "down")).toBe("not linked");
    expect(refiningSwapIllegalReason(after, 0, "down")).toBe(null);
    expect(refiningSwapIllegalReason(s, 0, "down")).toBe("not linked");
  });

  it("refuses a swap off the tower, an unlinked one and a tick that goes backwards or past the round", () => {
    const s = tower(["vov", "ot*", "***"]);
    expect(() => reduceRefining(s, { type: "swap", cell: 8, dir: "right", tick: 0 })).toThrow(InvalidMoveError);
    expect(() => reduceRefining(s, { type: "swap", cell: 6, dir: "down", tick: 0 })).toThrow(InvalidMoveError);
    expect(() => reduceRefining(s, { type: "swap", cell: 3, dir: "right", tick: 0 })).not.toThrow();
    expect(() => reduceRefining(s, { type: "swap", cell: 2, dir: "down", tick: 0 })).toThrow(InvalidMoveError);
    const later = reduceRefining(s, { type: "wait", tick: 5 });
    expect(() => reduceRefining(later, { type: "wait", tick: 4 })).toThrow(InvalidMoveError);
    expect(() => reduceRefining(later, { type: "wait", tick: cfg.maxTick + 1 })).toThrow(InvalidMoveError);
  });

  it("grades a column: clear, smooth, plain and foul rise; dump and spill sink", () => {
    const g = (s: string, run = 0) => refiningGradeColumn(cfg, s.split("").map((ch) => ({ v: 0, o: 1, t: 2, s: 3, "*": 4 })[ch] as RefiningKind), run);
    expect(g("vvvv")).toMatchObject({ up: true, grade: "clear", run: 1, points: 100 });
    expect(g("vv*v", 2)).toMatchObject({ grade: "clear", run: 3, points: 300 + 50 });
    expect(g("vvvv", 9)).toMatchObject({ grade: "clear", run: 10, points: 500 });
    expect(g("vvvo", 3)).toMatchObject({ up: true, grade: "smooth", run: 0, points: cfg.smoothPoints });
    expect(g("vvoo")).toMatchObject({ up: true, grade: "plain", points: 0 });
    expect(g("oooo")).toMatchObject({ up: true, grade: "plain", points: 0 });
    expect(g("vvtv")).toMatchObject({ up: true, grade: "foul", points: -cfg.foulPoints });
    expect(g("vsvv")).toMatchObject({ up: true, grade: "foul", points: -cfg.foulPoints });
    expect(g("vvtt")).toMatchObject({ up: true, grade: "foul", points: -2 * cfg.foulPoints });
    expect(g("ttoo", 4)).toMatchObject({ up: false, grade: "dump", run: 4, points: 0, spilled: 0 });
    expect(g("ttvo", 4)).toMatchObject({ up: false, grade: "spill", run: 0, spilled: 1 });
  });

  it("a draw takes the outlet, moves every column right and feeds a fresh one in at the left", () => {
    const s = tower(["ovvv", "otvv", "otvv"], { smokeEvery: 0 });
    const before = s.cells.map((c) => c.id);
    const after = reduceRefining(s, { type: "draw", tick: 2 });
    const e = after.events.at(-1)!;
    expect(e.type).toBe("draw");
    if (e.type !== "draw") return;
    expect(e.early).toBe(true);
    expect(e.value.grade).toBe("clear");
    expect(after.score).toBe(100);
    expect(after.run).toBe(1);
    expect(e.column.map((p) => p.id)).toEqual([before[3], before[7], before[11]]);
    // What was in columns 0 to 2 is now in 1 to 3.
    for (let r = 0; r < 3; r++) for (let c = 1; c < 4; c++) expect(after.cells[r * 4 + c]!.id).toBe(before[r * 4 + c - 1]);
    expect(refiningColumn(after, 0).map((p) => p.id)).toEqual(e.fresh.map((p) => p.id));
    expect(after.nextDraw).toBe(2 + cfg.pulseTicks);
  });

  it("the clock draws every pulse, and a move draws everything due first", () => {
    const s = createRefiningGame("clock");
    const w = reduceRefining(s, { type: "wait", tick: cfg.pulseTicks * 3 });
    expect(w.draws).toBe(3);
    expect(w.events.filter((e) => e.type === "draw")).toHaveLength(3);
    expect(w.nextDraw).toBe(cfg.pulseTicks * 4);
  });

  it("dumps leave the run alone; anything else that is not clear ends it", () => {
    const base = { smokeEvery: 0 };
    const run2 = { ...tower(["tvv", "tvv", "tvv"], base), run: 2 };
    const dumped = reduceRefining({ ...tower(["vvt", "vvt", "vvo"], base), run: 2 }, { type: "draw", tick: 1 });
    expect(dumped.run).toBe(2);
    expect(dumped.dumps).toBe(1);
    const cleared = reduceRefining(run2, { type: "draw", tick: 1 });
    expect(cleared.run).toBe(3);
    expect(cleared.score).toBe(300);
    const smooth = reduceRefining({ ...tower(["vvv", "vvo", "vvv"], base), run: 2 }, { type: "draw", tick: 1 });
    expect(smooth.run).toBe(0);
    expect(smooth.score).toBe(cfg.smoothPoints);
  });

  it("a foul column never takes the score below zero", () => {
    const s = tower(["vvt", "vvv", "vvv"], { smokeEvery: 0 });
    const after = reduceRefining(s, { type: "draw", tick: 1 });
    expect(after.score).toBe(0);
    const e = after.events.at(-1)!;
    expect(e.type === "draw" && e.value.points).toBe(-cfg.foulPoints);
    expect(e.type === "draw" && e.points).toBe(0);
  });

  it("every smokeEvery-th spilled vapour comes back as smoke on the top vapour nearest the outlet", () => {
    // The outlet spills one vapour: the first spilled, so no smoke yet at smokeEvery 2.
    const s = tower(["vvv", "ovt", "vvt"], { smokeEvery: 2 });
    const one = reduceRefining(s, { type: "draw", tick: 1 });
    expect(one.spilled).toBe(1);
    expect(one.cells.some((c) => c.kind === REFINING_SMOKE)).toBe(false);
    const two = reduceRefining({ ...s, spilled: 1 }, { type: "draw", tick: 1 });
    const e = two.events.at(-1)!;
    expect(e.type === "draw" && e.smoke).toHaveLength(1);
    // After the move right, the outlet is the old middle column: its top vapour turns.
    expect(two.cells[2]!.kind).toBe(REFINING_SMOKE);
    expect(two.cells.filter((c) => c.kind === REFINING_SMOKE)).toHaveLength(1);
  });

  it("the draw value is the grade the outlet would get now", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { state } = playRandom(seed, picks);
        if (state.finished) return;
        const v = refiningDrawValue(state);
        const after = reduceRefining(state, { type: "draw", tick: state.tick });
        const e = after.events.at(-1)!;
        expect(e.type === "draw" && e.value).toEqual(v);
      }),
      { numRuns: 30 },
    );
  });

  it("the hint is a legal swap that sorts the tower better, or none", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const s = createRefiningGame(seed);
        const h = refiningHint(s);
        if (!h) return;
        expect(refiningSwapIllegalReason(s, h.cell, h.dir)).toBe(null);
        const after = reduceRefining(s, { type: "swap", ...h, tick: 0 });
        expect(refiningSortedness(after)).toBeGreaterThan(refiningSortedness(s));
      }),
      { numRuns: 40 },
    );
  });

  it("the round is over at the last tick and at the move cap", () => {
    const s = reduceRefining(createRefiningGame("end"), { type: "wait", tick: cfg.maxTick });
    expect(s.finished).toBe(true);
    expect(s.draws).toBe(Math.floor(cfg.maxTick / cfg.pulseTicks));
    const capped = reduceRefining(createRefiningGame("cap", { ...cfg, maxMoves: 1 }), { type: "wait", tick: 1 });
    expect(capped.finished).toBe(true);
  });

  it("the view string names every cell", () => {
    expect(refiningViewString(tower(["vot", "s*v", "ooo"]).cells)).toBe("vots*vooo");
  });
});
