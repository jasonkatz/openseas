// Rungs 2 and 3 as the docs site teaches them: each sample on its pages, run as written.
import { describe, expect, it } from "vitest";
import { around, budget, clock, grid, holds, lines, listMoves, part, play, puzzle, read, refill, start, swap, whenProblem, type AnyMove, type Round, type SwapMove } from "../src/index.js";

const tuned = () =>
  puzzle("cooling", {
    board: grid("width", "height"),
    pieces: "kinds",
    parts: [swap({ along: "row" }), lines(3), refill()],
    ends: clock("roundSeconds"),
    settings: {
      width: 6, height: 12, kinds: 7,
      roundSeconds: { default: 150, min: 30, max: 600, unit: "seconds" },
      cascadePercent: [100, 200, 300],
      streakPercent: [100, 110, 120, 130, 140, 150],
    },
    payouts: { group: { on: "clear", counts: "pieces", growth: "superlinear" } },
    multipliers: {
      cascade: { scales: "group", by: "cascadePercent", index: "step" },
      streak: { scales: "group", by: "streakPercent", index: "streak" },
    },
    streak: { builds: "clear", grace: 1 },
  });

/** Plays hinted moves, a second apart, and gives back every round on the way. */
function playOut<M extends AnyMove>(first: Round<M>, moves: number, pick: (r: Round<M>, i: number) => M): Round<M>[] {
  const rounds = [first];
  for (let i = 0; i < moves; i++) rounds.push(play(rounds.at(-1)!, pick(rounds.at(-1)!, i), { at: (i + 1) * 1000 }));
  return rounds;
}

describe("rung 2: numbers and what pays, as data", () => {
  it("pays every clear from the payout and the step's multiplier, and banks each move once with the streak", () => {
    const puzzle = tuned();
    let steps = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const rounds = playOut(start(puzzle, { seed }), 30, (r, i) => {
        const all = listMoves(r);
        return all[(i * 31 + seed) % all.length]!;
      });
      let score = 0;
      for (const [i, r] of rounds.entries()) {
        if (i === 0) continue;
        const before = read(rounds[i - 1]!);
        let raw = 0;
        for (const e of r.last.events) {
          if (e.event !== "clear") continue;
          const n = (e.fields.pieces as unknown[]).length;
          expect(e.points).toBe(n * n * [1, 2, 3][Math.min(e.step!, 3) - 1]!);
          raw += e.points!;
          steps = Math.max(steps, e.step!);
        }
        const percent = [100, 110, 120, 130, 140, 150][Math.min(before.streak, 5)]!;
        expect(r.last.banked).toBe(Math.floor((raw * percent) / 100));
        score += r.last.banked;
        expect(read(r).score).toBe(score);
      }
    }
    expect(steps).toBeGreaterThan(1);
  });

  it("starts a round on other numbers, and refuses one out of its bounds", () => {
    const r = start(tuned(), { seed: 7, settings: { kinds: 5, roundSeconds: 60 } });
    expect(read(r).msLeft).toBe(60_000);
    expect(read(r, { at: 61_000 }).ended).toBe("clock");
    expect(() => start(tuned(), { seed: 7, settings: { roundSeconds: 5 } })).toThrow("setting roundSeconds: 5 is outside 30 to 600");
  });

  it("names what is wrong when the scoring names something the puzzle lacks", () => {
    const base = { board: grid(6, 7), pieces: 5, parts: [swap(), lines(3), refill()], ends: budget(20) } as const;
    expect(() => puzzle("p", { ...base, payouts: { group: { on: "clears", counts: "pieces" } } })).toThrow("p: payout group pays on the event clears, which the puzzle does not have");
    expect(() => puzzle("p", { ...base, payouts: { group: { on: "clear", counts: "pieces", reads: "groupPoints" } } })).toThrow("p: payout group reads groupPoints, which is no whole number among the settings");
    expect(() => puzzle("p", { ...base, multipliers: { streak: { scales: "clear", by: "lineMin", index: "streak" } } })).toThrow("p: multiplier streak reads lineMin, which is no list among the settings");
    expect(() => puzzle("p", { ...base, settings: { t: [100] }, multipliers: { streak: { scales: "clear", by: "t", index: "streak" } } })).toThrow("p: multiplier streak is indexed by the streak, and the puzzle declares none");
    expect(() => puzzle("p", { ...base, streak: { builds: "clear", when: "path >= 5" } })).toThrow('p: the streak: "path >= 5" names path, which is neither a field of the event nor a setting');
    expect(() => puzzle("p", { ...base, board: grid("width", 7) })).toThrow("p: the setting width has no value. Give it one among the settings");
  });

  it("holds a condition to one comparison of fields, settings and whole numbers", () => {
    expect(holds("size >= 5", { size: 5 }, {})).toBe(true);
    expect(holds("pieces >= lineMin", { pieces: [1, 2] }, { lineMin: 3 })).toBe(false);
    expect(holds("path.length != 4", { path: [1, 2, 3] }, {})).toBe(true);
    expect(whenProblem("size >= 5 and size < 9", ["size"], [])).toBe('"size >= 5 and size < 9" is not a comparison of two values');
    // A multiplier with a condition scales only the events that meet it, and the streak builds only on those that do.
    const big = puzzle("big", {
      board: grid(6, 7),
      pieces: 4,
      parts: [swap(), lines(3), refill()],
      ends: budget(40),
      settings: { bigPercent: 300, streakPercent: [100, 200] },
      multipliers: { big: { scales: "clear", on: "clear when size >= 4", by: "bigPercent" }, streak: { scales: "clear", by: "streakPercent", index: "streak" } },
      streak: { builds: "clear", when: "size >= 4" },
    });
    let bigs = 0;
    for (let seed = 1; seed <= 10; seed++) {
      let r = start(big, { seed });
      for (let i = 0; i < 40; i++) {
        const streak = read(r).streak;
        const all = listMoves(r);
        r = play(r, all[(i * 17 + seed) % all.length]!);
        const clears = r.last.events.filter((e) => e.event === "clear");
        for (const e of clears) expect(e.points).toBe((e.fields.size as number) * ((e.fields.size as number) >= 4 ? 3 : 1));
        const built = clears.some((e) => (e.fields.size as number) >= 4);
        expect(read(r).streak).toBe(built ? streak + 1 : 0);
        if (built) bigs++;
      }
    }
    expect(bigs).toBeGreaterThan(0);
  });
});

const boardOf = (r: Round): Parameters<NonNullable<ReturnType<typeof tuned>["rules"]["listMoves"]>>[0]["board"] => {
  const board = read(r).board;
  const has = (p: { x: number; y: number }): boolean => p.y >= 0 && p.y < board.length && p.x >= 0 && p.x < board[0]!.length;
  return { width: board[0]!.length, height: board.length, has, at: (p) => (has(p) ? board[p.y]![p.x]! : null), places: () => board.flatMap((row, y) => row.map((_, x) => ({ x, y }))) };
};

describe("rung 3: a part of one's own", () => {
  const charge = part({
    name: "charge",
    rule: "a charge swapped clears everything around it",
    pieces: [{ id: "charge" }],
    events: [{ id: "burst", description: "a charge cleared everything around it", fields: { at: "place", pieces: "places", points: "points" }, changes: ["leave"], step: true }],
    hooks: {
      onMove: {
        swap(ctx, _seat, { a, b }: SwapMove) {
          const at = [a, b].find((p) => ctx.board.at(p)?.piece === "charge");
          if (!at) return;
          const pieces = around(ctx.board, at, 1);
          ctx.emit("burst", { at, pieces }, (e) => pieces.forEach((p) => e.leave(p)));
        },
      },
    },
  });
  const heat = part<never, { heat: number }>({
    name: "heat",
    rule: "the heat rises with every move and falls with the points banked",
    settings: [{ id: "heatStart", type: "whole", default: 3, min: 0, max: 12, description: "rows under heat when a round starts", group: "tempo" }],
    hooks: {
      onStart: (ctx) => ({ heat: ctx.settings.heatStart as number }),
      onMoveEnd: (ctx) => ({ heat: Math.max(0, ctx.state.heat + 1 - Math.floor(ctx.pending / 40)) }),
    },
  });
  const own = puzzle("cooling", {
    board: grid(6, 12),
    pieces: 7,
    parts: [swap({ along: "row" }), charge, lines(3), refill({ mix: [{ piece: "charge", permille: "chargePermille" }] }), heat],
    ends: budget(60),
    settings: { chargePermille: 60 },
  });

  it("plays a part with a piece, an event and a state of its own beside the stock ones", () => {
    let bursts = 0;
    for (let seed = 1; seed <= 10; seed++) {
      let r = start(own, { seed });
      expect(read(r).state).toEqual({ heat: { heat: 3 } });
      for (let i = 0; !read(r).ended; i++) {
        const before = (read(r).state as { heat: { heat: number } }).heat.heat;
        const all = listMoves(r);
        const charged = all.find((m) => [m.a, m.b].some((p) => boardOf(r).at(p)?.piece === "charge"));
        r = play(r, charged ?? all[(i * 13 + seed) % all.length]!);
        for (const e of r.last.events) if (e.event === "burst") (bursts++, expect(e.points).toBe((e.fields.pieces as unknown[]).length));
        expect((read(r).state as { heat: { heat: number } }).heat.heat).toBe(Math.max(0, before + 1 - Math.floor(r.last.banked / 40)));
      }
    }
    expect(bursts).toBeGreaterThan(0);
  });
});
