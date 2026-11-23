import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_FREEFALL_CONFIG,
  InvalidMoveError,
  createFreefallGame,
  freefallBayValue,
  freefallBayValues,
  freefallDropValue,
  freefallEntryLanes,
  freefallRowSpan,
  freefallFall,
  freefallHint,
  freefallViewString,
  hashFreefallState,
  reduceFreefall,
  replayFreefall,
  summarizeFreefall,
  validateFreefallConfig,
  type FreefallConfig,
  type FreefallMove,
  type FreefallRocker,
  type FreefallState,
} from "../src/index.js";

const cfg = DEFAULT_FREEFALL_CONFIG;
const lanesArb = fc.array(fc.nat({ max: 31 }), { minLength: 0, maxLength: 60 });
/** An entry lane from any number. */
const entry = (n: number, config: FreefallConfig = cfg): number => freefallEntryLanes(config)[0] + (n % config.entry);

function play(seed: string, lanes: readonly number[], config: FreefallConfig = cfg): { moves: FreefallMove[]; state: FreefallState } {
  let state = createFreefallGame(seed, config);
  const moves: FreefallMove[] = [];
  for (const lane of lanes) {
    if (state.finished) break;
    const m: FreefallMove = { type: "drop", lane: entry(lane, config) };
    moves.push(m);
    state = reduceFreefall(state, m);
  }
  return { moves, state };
}

/** A hand-made shaft on a small config: no rival, flat berths worth 1. */
const small: FreefallConfig = {
  ...cfg,
  width: 4,
  entry: 4,
  rows: 2,
  gapPermille: 0,
  rival: false,
  quotas: [1000, 1000, 1000, 1000],
  bays: { first: [1, 1], second: [1, 1], third: [1, 1], fourth: [1, 1] },
};
function shaft(rockers: FreefallRocker[], over: Partial<FreefallConfig> = {}): FreefallState {
  return { ...createFreefallGame("hand", { ...small, ...over }), rockers };
}

describe("freefall determinism (ADR 0003)", () => {
  it("replay equals play", () => {
    fc.assert(
      fc.property(fc.string(), lanesArb, (seed, lanes) => {
        const { moves, state } = play(seed, lanes);
        expect(hashFreefallState(replayFreefall(seed, cfg, moves))).toBe(hashFreefallState(state));
      }),
      { numRuns: 60 },
    );
  });

  it("reduce never mutates its input", () => {
    fc.assert(
      fc.property(fc.string(), lanesArb, fc.nat({ max: 7 }), (seed, lanes, lane) => {
        const { state } = play(seed, lanes);
        if (state.finished) return;
        const before = JSON.stringify(state);
        reduceFreefall(state, { type: "drop", lane: entry(lane) });
        expect(JSON.stringify(state)).toBe(before);
      }),
      { numRuns: 60 },
    );
  });

  it("different seeds deal different shafts", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) seen.add(freefallViewString(cfg, createFreefallGame(`s${i}`, cfg).rockers));
    expect(seen.size).toBeGreaterThan(15);
  });

  it("takes end as its first move", () => {
    const s = reduceFreefall(createFreefallGame("x", cfg), { type: "end" });
    expect(s.finished).toBe(true);
    expect(summarizeFreefall(s)).toEqual({ score: 0, moves: 0, bestCombo: 0 });
  });

  it("pods are conserved: every pod dropped is at rest or landed", () => {
    fc.assert(
      fc.property(fc.string(), lanesArb, (seed, lanes) => {
        let state = createFreefallGame(seed, cfg);
        let landed = 0;
        for (const lane of lanes) {
          if (state.finished) break;
          state = reduceFreefall(state, { type: "drop", lane: entry(lane) });
          for (const d of state.lastMove!.drops) for (const l of d.landed) landed += l.ids.length;
        }
        const resting = state.rockers.filter((r) => r.pod !== 0).length;
        expect(resting + landed).toBe(state.nextId - 1);
      }),
      { numRuns: 60 },
    );
  });

  it("a drop's value is what the drop scores", () => {
    fc.assert(
      fc.property(fc.string(), lanesArb, fc.nat({ max: 7 }), (seed, lanes, lane) => {
        const { state } = play(seed, lanes, { ...cfg, rival: false });
        if (state.finished) return;
        const v = freefallDropValue(state, entry(lane));
        const next = reduceFreefall(state, { type: "drop", lane: entry(lane) });
        expect(next.lastMove!.drops[0]!.points).toBe(v.points);
      }),
      { numRuns: 60 },
    );
  });
});

describe("freefall rules", () => {
  it("berths mirror about the middle", () => {
    expect(freefallBayValues(cfg, 1)).toEqual([...[...cfg.bays.second].reverse(), ...cfg.bays.second]);
    expect(freefallBayValue(cfg, 3, 0)).toBe(cfg.bays.fourth[cfg.width / 2 - 1]);
  });

  it("the shaft widens like a tree: the entry lanes at the top, the whole width at the foot", () => {
    expect(freefallRowSpan(cfg, 0)).toEqual(freefallEntryLanes(cfg));
    expect(freefallRowSpan(cfg, cfg.rows - 1)).toEqual([0, cfg.width - 1]);
    for (let r = 1; r < cfg.rows; r++) expect(freefallRowSpan(cfg, r)[0]).toBeLessThanOrEqual(freefallRowSpan(cfg, r - 1)[0]);
    const s = createFreefallGame("tree", cfg);
    for (const k of s.rockers) {
      const [lo, hi] = freefallRowSpan(cfg, k.row);
      expect(k.lane).toBeGreaterThanOrEqual(lo);
      expect(k.lane + 1).toBeLessThanOrEqual(hi);
    }
    expect(() => reduceFreefall(s, { type: "drop", lane: 0 })).toThrow(InvalidMoveError);
  });

  it("a pod comes to rest in an empty cradle, and the rocker does not move", () => {
    const s = shaft([{ lane: 0, row: 0, cradle: 0, pod: 0 }]);
    const n = reduceFreefall(s, { type: "drop", lane: 0 });
    expect(n.rockers[0]).toEqual({ lane: 0, row: 0, cradle: 0, pod: 1 });
    expect(n.score).toBe(0);
  });

  it("a pod onto the arm passes, flips the rocker, and tosses the pod at rest", () => {
    const s = shaft([{ lane: 0, row: 0, cradle: 0, pod: 7 }]);
    const n = reduceFreefall(s, { type: "drop", lane: 1 });
    expect(n.rockers[0]!.cradle).toBe(1);
    expect(n.rockers[0]!.pod).toBe(0);
    // Two singles land, one in lane 0 and one in lane 1.
    expect(n.lastMove!.drops[0]!.landed.map((l) => [l.lane, l.ids.length])).toEqual([
      [0, 1],
      [1, 1],
    ]);
    expect(n.score).toBe(2);
  });

  it("a pod onto a full cradle rolls over and falls past the arm", () => {
    const s = shaft([{ lane: 0, row: 0, cradle: 0, pod: 7 }]);
    const f = freefallFall(s.config, s.rockers, 0, 0, 9);
    expect(f.steps[0]!.flipped).toEqual([{ rocker: 0, times: 1 }]);
    expect(f.steps[0]!.tossed).toEqual([{ rocker: 0, id: 7, lane: 0 }]);
    expect(f.landed.map((l) => l.lane)).toEqual([0, 1]);
  });

  it("pods meeting in a lane fuse, and a cluster scores its berth n * n", () => {
    // Row 0: a full cradle on lane 1 over arm lane 2 tosses into lane 1 while the drop passes down lane 2.
    // Row 1: a full cradle on lane 1, arm lane 2... both pods reach row 1 in lanes 1 and 2.
    const s = shaft([
      { lane: 1, row: 0, cradle: 0, pod: 5 },
      { lane: 1, row: 1, cradle: 1, pod: 6 },
    ]);
    // Drop down lane 2 (row 0's arm): flips row 0, tosses 5 down lane 1; the drop goes on down lane 2.
    // Row 1: lane 2 is the cradle (full, holds 6): the drop rolls to lane 1, joining 5 there: 2 pass the arm,
    // an even flip, so 6 lands back. A cluster of 2 lands in lane 1.
    const n = reduceFreefall(s, { type: "drop", lane: 2 });
    const landed = n.lastMove!.drops[0]!.landed;
    expect(landed).toHaveLength(1);
    expect(landed[0]!.lane).toBe(1);
    expect(landed[0]!.ids).toHaveLength(2);
    expect(landed[0]!.points).toBe(4);
    expect(n.rockers[1]).toEqual({ lane: 1, row: 1, cradle: 1, pod: 6 });
    const linear = reduceFreefall(shaft(s.rockers.map((r) => ({ ...r })), { squareClusters: false }), { type: "drop", lane: 2 });
    expect(linear.score).toBe(2);
  });

  it("a cluster onto an empty cradle leaves one pod at rest when an even number roll on", () => {
    const s = shaft([
      { lane: 1, row: 0, cradle: 0, pod: 5 },
      { lane: 1, row: 1, cradle: 1, pod: 0 },
    ]);
    // A cluster of 2 reaches row 1 at lane 1 (the arm): wait, lane 2 is the cradle. Drop in lane 2:
    // row 0 tosses 5 to lane 1, the drop in lane 2 reaches row 1's empty cradle and rests;
    // 5 reaches row 1's arm (lane 1) alone: one flip, so the drop just rested is tossed down lane 2.
    const n = reduceFreefall(s, { type: "drop", lane: 2 });
    expect(n.rockers[1]!.pod).toBe(0);
    expect(n.rockers[1]!.cradle).toBe(0);
    expect(n.lastMove!.drops[0]!.landed.map((l) => l.lane)).toEqual([1, 2]);
  });

  it("without a rival a leg ends at its quota, and the round after four", () => {
    let s = createFreefallGame("legs", { ...cfg, rival: false, quotas: [1, 1, 1, 1] });
    let lane = 0;
    while (!s.finished && s.moveCount < 300) {
      s = reduceFreefall(s, { type: "drop", lane: entry(lane++) });
    }
    expect(s.finished).toBe(true);
    expect(s.legsWon).toBe(4);
  });

  it("with a rival, the other side drops once more after a quota is reached", () => {
    fc.assert(
      fc.property(fc.string(), lanesArb, (seed, lanes) => {
        let s = createFreefallGame(seed, cfg);
        for (const lane of lanes) {
          if (s.finished) break;
          const before = s;
          s = reduceFreefall(s, { type: "drop", lane: entry(lane) });
          const drops = s.lastMove!.drops;
          // A player's drop that closes a leg the rival reached is followed by the rival opening the next.
          if (before.closing === 1) expect(drops[0]!.legEnded).toBe(true);
          if (before.closing === 0) throw new Error("the rival always answers a player who reaches the quota");
          // A player who reaches the quota is answered by one more rival drop, which closes the leg.
          if (before.closing === null && !drops[0]!.legEnded && before.legPoints[0] + drops[0]!.points >= before.config.quotas[before.leg]! && drops.length === 2) {
            expect(drops[1]!.legEnded).toBe(true);
          }
        }
        expect(s.score).toBe(Math.max(0, s.totals[0] - s.totals[1]));
      }),
      { numRuns: 60 },
    );
  });

  it("rejects a lane off the shaft and a move after the end", () => {
    const s = createFreefallGame("x", cfg);
    expect(() => reduceFreefall(s, { type: "drop", lane: cfg.width })).toThrow(InvalidMoveError);
    const done = reduceFreefall(s, { type: "end" });
    expect(() => reduceFreefall(done, { type: "drop", lane: 0 })).toThrow(InvalidMoveError);
  });

  it("validates its config", () => {
    expect(() => validateFreefallConfig({ ...cfg, width: 7 })).toThrow();
    expect(() => validateFreefallConfig({ ...cfg, entry: cfg.width + 2 })).toThrow();
    expect(() => validateFreefallConfig({ ...cfg, quotas: [1, 2, 3] })).toThrow();
    expect(() => validateFreefallConfig({ ...cfg, bays: { ...cfg.bays, first: [1, 2] } })).toThrow();
    expect(() => validateFreefallConfig(cfg)).not.toThrow();
  });

  it("hints a drop worth the most", () => {
    const s = shaft([{ lane: 0, row: 0, cradle: 0, pod: 7 }]);
    expect(freefallHint(s)).toBe(0);
  });
});
