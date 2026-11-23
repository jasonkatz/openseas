import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { applyChanges, boardString, findRunsForTest, momentOf, Refused, replay, SWAP, type Board, type Entry, type PieceOn, type Round, type RoundEvent, type SwapState } from "../src/index.js";
import { run, swap, swaps } from "./helpers.js";

const STAGES = ["runs", "chains", "specials", "full"] as const;

/** A log's worth of entries no round refuses: swaps anywhere on the board at rising times, and now and then a `level` signal. */
const plays = fc.array(fc.record({ gap: fc.integer({ min: 0, max: 900 }), cell: fc.nat(), right: fc.boolean(), level: fc.option(fc.integer({ min: 0, max: 12 }), { freq: 12 }) }), { maxLength: 60 });
type Plays = typeof plays extends fc.Arbitrary<infer T> ? T : never;

function entriesOf(round: Round<SwapState>, list: Plays): Entry[] {
  const { width, height } = round.board;
  const line = round.settings.layers.includes("line");
  let at = 0;
  return list.map((p) => {
    at += p.gap;
    if (p.level !== null && line) return { at, signal: { id: "level", value: p.level } };
    const row = Math.floor(p.cell / width) % height;
    const col = p.cell % (width - 1);
    return p.right ? { at, move: { id: "swap", at: row * width + col, to: "right" } } : { at, move: { id: "swap", at: row * width + col + 1, to: "left" } };
  });
}

function playAll(seed: string, stage: string, list: Plays): { round: Round<SwapState>; events: RoundEvent[][]; entries: Entry[] } {
  let round = swap.start(seed, swap.settings({ stage }));
  const entries = entriesOf(round, list);
  const events: RoundEvent[][] = [];
  for (const entry of entries) {
    const played = swap.play(round, entry);
    round = played.round;
    events.push([...played.events]);
  }
  return { round, events, entries };
}

const freeze = <T>(v: T): T => {
  if (typeof v === "object" && v !== null && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v)) freeze(x);
  }
  return v;
};

describe("the same seed, settings and log always make the same round", () => {
  test("a replay of the log is the round that was played", () => {
    fc.assert(
      fc.property(fc.string(), fc.constantFrom(...STAGES), plays, (seed, stage, list) => {
        const { round, entries } = playAll(seed, stage, list);
        const settings = swap.settings({ stage });
        const again = replay(swap, { seed, layers: settings.layers, settings: settings.values, log: { entries, end: round.at } });
        expect(swap.hash(again.round)).toBe(swap.hash(round));
        expect(again.round).toEqual(round);
      }),
      { numRuns: 150 },
    );
  });

  test("playing an entry never changes the round it was played on", () => {
    fc.assert(
      fc.property(fc.string(), fc.constantFrom(...STAGES), plays, (seed, stage, list) => {
        let round = freeze(swap.start(seed, swap.settings({ stage })));
        for (const entry of entriesOf(round, list)) {
          const before = swap.hash(round);
          const next = freeze(swap.play(round, entry).round);
          expect(swap.hash(round)).toBe(before);
          round = next;
        }
      }),
      { numRuns: 60 },
    );
  });

  test("different seeds deal different boards", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        fc.pre(a !== b);
        const s = swap.settings();
        expect(boardString(swap.start(a, s).board)).not.toBe(boardString(swap.start(b, s).board));
      }),
    );
  });
});

describe("what comes out", () => {
  test("a board drawn from the start and the events alone matches the round", () => {
    fc.assert(
      fc.property(fc.string(), fc.constantFrom(...STAGES), plays, (seed, stage, list) => {
        let drawn: Board = swap.start(seed, swap.settings({ stage })).board;
        const { round, events } = playAll(seed, stage, list);
        for (const entry of events) for (const e of entry) drawn = applyChanges(drawn, e.changes);
        expect(boardString(drawn)).toBe(boardString(round.board));
      }),
      { numRuns: 150 },
    );
  });

  test("the score is the sum of the events' points, split by payout, and never below zero", () => {
    fc.assert(
      fc.property(fc.string(), fc.constantFrom(...STAGES), plays, (seed, stage, list) => {
        const { round, events } = playAll(seed, stage, list);
        const all = events.flat();
        expect(round.score).toBe(all.reduce((sum, e) => sum + e.points, 0));
        expect(round.score).toBeGreaterThanOrEqual(0);
        for (const e of all) expect(Object.values(e.paid).reduce((a, b) => a + b, 0)).toBe(e.points);
        expect(Object.values(round.paid).reduce((a, b) => a + b, 0)).toBe(round.score);
        // Every number a player sees counted arrives on an event.
        for (const e of all) if ("points" in e.fields) expect(e.fields["points"]).toBe(e.points);
      }),
      { numRuns: 100 },
    );
  });

  test("the board is always full and settled between entries: no gap, no run left standing, every id its own", () => {
    fc.assert(
      fc.property(fc.string(), fc.constantFrom(...STAGES), plays, (seed, stage, list) => {
        const { round } = playAll(seed, stage, list);
        expect(round.board.cells.every((p) => p !== null)).toBe(true);
        expect(findRunsForTest(round.board)).toEqual([]);
        expect(new Set(round.board.cells.map((p) => p!.id)).size).toBe(round.board.cells.length);
      }),
      { numRuns: 100 },
    );
  });

  test("a stage deals only its own layers' pieces and reports only its own events", () => {
    fc.assert(
      fc.property(fc.string(), plays, (seed, list) => {
        const runs = playAll(seed, "runs", list);
        expect(runs.round.board.cells.every((p) => p!.piece === "kind")).toBe(true);
        expect(runs.events.flat().every((e) => ["trade", "run", "rise"].includes(e.id))).toBe(true);
        const specials = playAll(seed, "specials", list);
        expect(specials.round.board.cells.every((p) => p!.piece !== "float")).toBe(true);
      }),
      { numRuns: 60 },
    );
  });
});

describe("the deal", () => {
  test("the opening board holds no run and no float, for any settings", () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 3, max: 12 }), fc.integer({ min: 3, max: 16 }), fc.integer({ min: 3, max: 8 }), (seed, width, height, kinds) => {
        const round = swap.start(seed, swap.settings({ values: { width, height, kinds, startRows: 0, minRows: 0, dangerRows: 1, burstPermille: 200, sweepPermille: 200 } }));
        expect(findRunsForTest(round.board)).toEqual([]);
        expect(round.board.cells.every((p) => p !== null && p.piece !== "float")).toBe(true);
        expect(round.board.cells.every((p) => p!.piece !== "kind" || (p!.kind! >= 1 && p!.kind! <= kinds))).toBe(true);
      }),
    );
  });

  test("every draw has a stream of its own: a stage's opening board is the whole puzzle's, less the pieces its layers do not deal", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const full = swap.start(seed, swap.settings()).board.cells;
        const runs = swap.start(seed, swap.settings({ stage: "runs" })).board.cells;
        // Where the whole puzzle laid an ordinary piece next to no special, the first stage laid the same kind.
        const width = 6;
        full.forEach((p, i) => {
          const near = [i - 1, i - 2, i - width, i - 2 * width].filter((j) => j >= 0).every((j) => full[j]!.piece === "kind");
          if (p!.piece === "kind" && near && full.slice(0, i).every((q) => q!.piece === "kind")) expect(runs[i]!.kind).toBe(p!.kind);
        });
      }),
    );
  });

  test("two rounds on one seed meet the same kinds for as long as they ask alike, whatever the specials deal", () => {
    // The kind stream is asked once for every new piece, so turning the specials up changes which
    // pieces are specials and never which kinds the rest are.
    const few = run(swap, { seed: "streams", stage: "runs", every: 5000, how: "careless", values: { roundSeconds: 20 } });
    const again = run(swap, { seed: "streams", stage: "runs", every: 5000, how: "careless", values: { roundSeconds: 20 } });
    expect(boardString(few.round.board)).toBe(boardString(again.round.board));
    expect(few.round.streams["special"]).toBeUndefined();
    expect(few.round.streams["float"]).toBeUndefined();
  });
});

/** A round on a board laid by hand: a row a string, a digit a kind, B a burst, S a sweep, F a float. */
function laid(rows: readonly string[], opts: { stage?: string; values?: Record<string, number | number[]> } = {}): Round<SwapState> {
  const values = { width: rows[0]!.length, height: rows.length, startRows: 0, minRows: 0, dangerRows: 1, ...opts.values };
  const round = swap.start("laid", swap.settings({ stage: opts.stage ?? "full", values }));
  const cells = rows.flatMap((row, r) =>
    [...row].map((ch, c): PieceOn => {
      const id = 1000 + r * row.length + c;
      return ch === "B" ? { id, piece: "burst" } : ch === "S" ? { id, piece: "sweep" } : ch === "F" ? { id, piece: "float" } : { id, piece: "kind", kind: Number(ch) };
    }),
  );
  return { ...round, board: { ...round.board, cells } };
}

const swapAt = (round: Round<SwapState>, at: number, to: "left" | "right", time = 1000) => swap.play(round, { at: time, move: { id: "swap", at, to } });
const first = (events: readonly RoundEvent[], id: string): RoundEvent => events.find((e) => e.id === id)!;

describe("the rules", () => {
  test("a swap trades two pieces, and a run of three clears for 3 points", () => {
    // 1 1 2 3: trading the 2 and the 3 lines nothing up, so the swap only trades.
    const { events, round: after } = swapAt(laid(["1123", "4516", "2345", "5432"], { stage: "runs" }), 2, "right");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: "trade", step: 1, fields: { a: 2, b: 3 }, changes: [{ change: "travel", id: 1002, from: 2, to: 3 }, { change: "travel", id: 1003, from: 3, to: 2 }] });
    expect(after.score).toBe(0);
    expect(after.board.cells.slice(0, 4).map((p) => p!.kind)).toEqual([1, 1, 3, 2]);
    // 1 1 2 1: trading the 2 and the last 1 makes three in a row.
    const row = swapAt(laid(["1121", "4536", "2345", "5432"], { stage: "runs" }), 2, "right");
    const cleared = first(row.events, "run");
    expect(cleared.fields).toMatchObject({ places: [0, 1, 2], points: 3 });
    expect(cleared.paid).toEqual({ run: 3 });
    expect(cleared.changes.map((c) => c.change)).toEqual(["leave", "leave", "leave"]);
    expect(row.events[2]!.id).toBe("rise");
    // Swiping the right piece left is the same swap.
    const left = swapAt(laid(["1121", "4536", "2345", "5432"], { stage: "runs" }), 3, "left");
    expect(left.round.score).toBe(row.round.score);
  });

  test("a longer run pays by the table, and runs that touch are one group", () => {
    // Swapping the 2 and the 1 at the end of the top row makes 1 1 1 1.
    const four = swapAt(laid(["11121", "34534", "45345", "53453"], { stage: "runs" }), 3, "right");
    expect(first(four.events, "run").fields).toMatchObject({ places: [0, 1, 2, 3], points: 8 });
    // An L: three across the top and three down the first column, joined at the corner, are one group of 5.
    const ell = swapAt(laid(["1121", "1345", "1453", "3534"], { stage: "runs" }), 2, "right");
    expect(first(ell.events, "run").fields).toMatchObject({ places: [0, 1, 2, 4, 8], points: 15 });
  });

  test("pieces rise into the gaps and new ones come in from below", () => {
    const { events, round } = swapAt(laid(["1121", "4536", "2345", "5432"], { stage: "runs" }), 2, "right");
    const rise = first(events, "rise");
    const travels = rise.changes.filter((c) => c.change === "travel");
    const arrivals = rise.changes.filter((c) => c.change === "arrive");
    // Three columns lost their top cell: nine pieces rise a row, and three arrive in the bottom row from below.
    expect(travels).toHaveLength(9);
    expect(travels.every((c) => c.change === "travel" && c.to === c.from - 4)).toBe(true);
    expect(arrivals.map((c) => c.change === "arrive" && [c.at, c.from])).toEqual([[12, { off: "down" }], [13, { off: "down" }], [14, { off: "down" }]]);
    expect(round.board.cells[0]!.id).toBe(1004);
  });

  test("each later step of a cascade multiplies by the table, and a stage without the layer pays every step alike", () => {
    const table = [0, 0, 3, 8, 15, 24, 35, 48];
    let cascades = 0;
    for (let n = 0; n < 40; n++) {
      for (const stage of ["runs", "chains"] as const) {
        const round = swap.start(`cascade-${n}`, swap.settings({ stage }));
        for (const move of swaps(round)) {
          for (const e of swap.play(round, { at: 1, move }).events.filter((x) => x.id === "run")) {
            const base = table[(e.fields["places"] as number[]).length - 1]!;
            expect(e.points).toBe(stage === "runs" ? base : base * Math.min(e.step, 3));
            if (e.step > 1) cascades++;
          }
        }
      }
    }
    expect(cascades).toBeGreaterThan(10);
  });

  test("two groups cleared in one step pay the bonus for clearing together", () => {
    // The swap at the middle makes 1 1 1 on the left of the row and 2 2 2 on the right.
    const round = laid(["112122", "345345", "453453", "534534"], { stage: "chains" });
    const { events } = swapAt(round, 2, "right");
    const step1 = events.filter((e) => e.step === 1);
    expect(step1.map((e) => e.id)).toEqual(["trade", "run", "run", "together", "rise"]);
    expect(first(events, "together")).toMatchObject({ fields: { groups: 2, points: 10 }, paid: { together: 10 } });
    // Without the layer the two runs clear and nothing more is paid.
    const plain = swapAt(laid(["112122", "345345", "453453", "534534"], { stage: "runs" }), 2, "right");
    expect(plain.events.filter((e) => e.step === 1).map((e) => e.id)).toEqual(["trade", "run", "run", "rise"]);
  });

  test("scoring swaps in a row multiply, one swap that scores nothing is forgiven, and a second breaks the streak", () => {
    const values = { width: 6, height: 12, startRows: 0, minRows: 0, dangerRows: 1 };
    let round = swap.start("streak", swap.settings({ stage: "chains", values }));
    const scoring = (r: Round<SwapState>) => swaps(r).find((m) => swap.play(r, { at: r.at, move: m }).round.score > r.score);
    const blank = (r: Round<SwapState>) => swaps(r).find((m) => swap.play(r, { at: r.at, move: m }).round.score === r.score)!;
    const counts: number[] = [];
    for (let i = 0; i < 3; i++) {
      const move = scoring(round);
      if (!move) return;
      const played = swap.play(round, { at: round.at, move });
      const run = first(played.events, "run");
      // The first success is paid at the table's first entry, the second at its second.
      const base = [0, 0, 3, 8, 15, 24, 35, 48][(run.fields["places"] as number[]).length - 1]!;
      expect(run.points).toBe(Math.floor((base * [100, 110, 120][i]!) / 100));
      expect(played.events.at(-1)).toMatchObject({ id: "streak", fields: { count: i + 1 } });
      round = played.round;
      counts.push(round.streak.count);
    }
    expect(counts).toEqual([1, 2, 3]);
    round = swap.play(round, { at: round.at, move: blank(round) }).round;
    expect(round.streak).toMatchObject({ count: 3, misses: 1 });
    round = swap.play(round, { at: round.at, move: blank(round) }).round;
    expect(round.streak).toMatchObject({ count: 0, best: 3 });
    expect(swap.read(round).stats["best_streak"]).toBe(3);
  });

  test("a burst clears the pieces round where it lands, a point each", () => {
    const { events } = swapAt(laid(["12345", "3B123", "45312", "23451", "51234"], { stage: "specials" }), 6, "right");
    const burst = first(events, "burst");
    expect(burst.fields).toMatchObject({ place: 7, places: [1, 2, 3, 6, 7, 8, 11, 12, 13], points: 9 });
    expect(burst.paid).toEqual({ burst: 9 });
  });

  test("a sweep clears itself and every piece of the kind it is swapped with, two points each", () => {
    const { events } = swapAt(laid(["12345", "3S123", "45312", "23451", "51234"], { stage: "specials" }), 6, "right");
    const sweep = first(events, "sweep");
    // It was swapped with the 1 on its right, and lands where that was.
    expect(sweep.fields).toMatchObject({ place: 7, places: [0, 6, 7, 13, 19, 21], points: 12 });
  });

  test("a float joins no run, and lifts off once it is above the line", () => {
    // Two rows under the line: the float in the third row from the bottom is above it and lifts with the next swap.
    const round = laid(["1234", "2F41", "3412", "4123"], { values: { startRows: 2, minRows: 2, dangerRows: 3 } });
    const { events, round: after } = swapAt(round, 0, "right");
    const lift = first(events, "lift");
    expect(lift.fields).toMatchObject({ places: [5], count: 1, points: 15 });
    expect(momentOf(SWAP, after.settings.values, lift)).toBeNull();
    expect(swap.read(after).stats).toMatchObject({ lifted: 1, best_lift: 1 });
    // A float under the line stays.
    const under = swapAt(laid(["1234", "2341", "3F12", "4123"], { values: { startRows: 2, minRows: 2, dangerRows: 3 } }), 0, "right");
    expect(under.events.some((e) => e.id === "lift")).toBe(false);
  });

  test("floats lifted together pay by their number squared, and that is the puzzle's moment", () => {
    const round = laid(["1F34", "2F41", "3412", "4123"], { values: { startRows: 2, minRows: 2, dangerRows: 3 } });
    const lift = first(swapAt(round, 2, "right").events, "lift");
    expect(lift.fields).toMatchObject({ count: 2, points: 60 });
    expect(lift.paid).toEqual({ lift: 60 });
    expect(momentOf(SWAP, round.settings.values, lift)).toBe(0.5);
  });

  test("the puzzle moves its own line: swaps raise it, points lower it, and it never drops below its least", () => {
    let round = laid(["1234", "2341", "3412", "4123", "1234", "2341"], { values: { startRows: 2, minRows: 2, dangerRows: 3, riseMoves: 2, ventPoints: 3, burstPermille: 0, sweepPermille: 0, floatPermille: 0 } });
    expect(swap.read(round).gauges["level"]).toEqual({ value: 2, most: 6, danger: 3 });
    // Two swaps that score nothing raise the line a row; the second reports it.
    let played = swapAt(round, 0, "right");
    expect(played.events.map((e) => e.id)).toEqual(["trade"]);
    played = swapAt(played.round, 0, "right");
    expect(played.events.map((e) => e.id)).toEqual(["trade", "level"]);
    expect(played.events[1]!.fields).toEqual({ rows: 3 });
    round = played.round;
    expect(round.state.rows).toBe(3);
    // Points lower it, and it stops at its least however many there are.
    const scored = swapAt({ ...round, board: laid(["1121", "2343", "3412", "4123", "1234", "2341"]).board }, 2, "right");
    expect(scored.round.score).toBeGreaterThanOrEqual(3);
    expect(scored.round.state.rows).toBeGreaterThanOrEqual(2);
    expect(scored.round.state.rows).toBeLessThan(3);
  });

  test("a level signal sets the line, and from then on the puzzle stops moving it", () => {
    const round = laid(["1234", "2341", "3412", "4123"], { values: { startRows: 1, minRows: 1, dangerRows: 3, riseMoves: 1 } });
    const signalled = swap.play(round, { at: 10, signal: { id: "level", value: 3 } });
    expect(signalled.events).toMatchObject([{ id: "level", step: 0, fields: { rows: 3 } }]);
    expect(signalled.round.moves).toBe(0);
    expect(signalled.round.entries).toBe(1);
    let r = signalled.round;
    for (let i = 0; i < 4; i++) r = swapAt(r, 0, "right", 20 + i).round;
    expect(r.state.rows).toBe(3);
    // The signal is no move: it breaks no streak and counts toward nothing.
    expect(r.moves).toBe(4);
    expect(() => swap.play(round, { at: 10, signal: { id: "level", value: 99 } })).toThrow(Refused);
    const noLine = laid(["1234", "2341", "3412", "4123"], { stage: "specials" });
    expect(() => swap.play(noLine, { at: 10, signal: { id: "level", value: 2 } })).toThrow(Refused);
  });
});

describe("what a round refuses", () => {
  const round = swap.start("refuse", swap.settings());
  const bad: readonly (readonly [string, unknown])[] = [
    ["a move the puzzle does not have", { id: "jump", at: 0 }],
    ["a cell off the board", { id: "swap", at: 72, to: "right" }],
    ["a place that is no cell", { id: "swap", at: 1.5, to: "right" }],
    ["a direction that is none", { id: "swap", at: 0, to: "north" }],
    ["up", { id: "swap", at: 6, to: "up" }],
    ["off the right edge", { id: "swap", at: 5, to: "right" }],
    ["off the left edge", { id: "swap", at: 6, to: "left" }],
    ["a missing field", { id: "swap", at: 0 }],
    ["a field too many", { id: "swap", at: 0, to: "right", twice: true }],
  ];
  test.each(bad)("%s", (_name, move) => {
    expect(() => swap.play(round, { at: 100, move: move as never })).toThrow(Refused);
    expect(swap.allows(round, move as never)).not.toBeNull();
  });

  test("a time that runs back, a time that is no whole number, an unknown signal and a signal of the wrong type", () => {
    const later = swap.play(round, { at: 500, move: { id: "swap", at: 0, to: "right" } }).round;
    expect(() => swap.play(later, { at: 499, move: { id: "swap", at: 0, to: "right" } })).toThrow(Refused);
    expect(() => swap.play(round, { at: 0.5, move: { id: "swap", at: 0, to: "right" } })).toThrow(Refused);
    expect(() => swap.play(round, { at: 1, signal: { id: "wind", value: 3 } })).toThrow(Refused);
    expect(() => swap.play(round, { at: 1, signal: { id: "level", value: true } })).toThrow(Refused);
    // Two entries may share a time.
    expect(swap.play(later, { at: 500, move: { id: "swap", at: 0, to: "right" } }).round.moves).toBe(2);
  });
});

describe("endings and the log", () => {
  test("the clock ends the round: it follows from the final time mark, and no entry is taken at or after it", () => {
    const round = swap.start("clock", swap.settings());
    expect(swap.mark(round, 149_999).round.ended).toBeNull();
    const ended = swap.mark(round, 150_000).round;
    expect(ended.ended).toEqual({ by: "clock", at: 150_000 });
    expect(swap.mark(round, 999_999).round).toMatchObject({ at: 150_000, ended: { by: "clock", at: 150_000 } });
    expect(() => swap.play(round, { at: 150_000, move: { id: "swap", at: 0, to: "right" } })).toThrow(Refused);
    expect(() => swap.play(ended, { at: 150_000, move: { id: "swap", at: 0, to: "right" } })).toThrow(Refused);
    expect(swap.play(round, { at: 149_999, move: { id: "swap", at: 0, to: "right" } }).round.ended).toBeNull();
  });

  test("the log is capped at a fixed length", () => {
    let round = swap.start("cap", swap.settings());
    for (let i = 0; i < SWAP.round.logLimit; i++) round = swap.play(round, { at: i, move: { id: "swap", at: 0, to: "right" } }).round;
    expect(() => swap.play(round, { at: SWAP.round.logLimit, move: { id: "swap", at: 0, to: "right" } })).toThrow(/log/);
  });
});

describe("judgement", () => {
  test("a round reads its tier from the puzzle's tier starts, and its pace from the recent stretch", () => {
    const { round } = run(swap, { seed: "judge", every: 1500, how: "greedy" });
    const read = swap.read(round);
    expect(read.ended).toEqual({ by: "clock", at: 150_000 });
    expect(read.performance).not.toBeNull();
    const start = swap.start("judge", swap.settings());
    expect(swap.read(start)).toMatchObject({ score: 0, performance: 1000, tier: "green" });
    expect(swap.pace(start, 5000)).toEqual({ performance: 1000, tier: "green" });
    // Thirty points in the last ten seconds is 450 over a whole round: between Steady and Sharp.
    const scored = { ...start, at: 20_000, score: 30, recent: [[15_000, 30]] as const };
    expect(swap.pace(scored, 20_000)).toEqual({ performance: 1300 + Math.floor(((450 - 220) * 300) / 360), tier: "steady" });
    // The stretch moves on: twelve seconds later those points are behind it.
    expect(swap.pace(scored, 27_000)?.tier).toBe("green");
  });
});
