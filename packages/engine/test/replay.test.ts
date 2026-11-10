import { describe, expect, it } from "vitest";
import {
  BATTLE_DEF,
  COOLING_DEF,
  DEFAULT_BATTLE_CONFIG,
  DEFAULT_COOLING_CONFIG,
  DEFAULT_GUNNERY_CONFIG,
  GUNNERY_DEF,
  createCoolingGame,
  previewSwap,
  pureMoveRejection,
  replayLog,
  type BattleConfig,
  type BattleMove,
  type CoolingMove,
  type GunneryConfig,
  type GunneryMove,
} from "../src/index.js";

const cooling = DEFAULT_COOLING_CONFIG;

/** A handful of legal Cooling swaps for a seed: the first swap that clears something, move by move. */
function someSwaps(seed: string, n: number): CoolingMove[] {
  let s = createCoolingGame(seed, cooling);
  const moves: CoolingMove[] = [];
  outer: for (let i = 0; i < n; i++) {
    for (let row = 0; row < s.config.height; row++) {
      for (let col = 0; col < s.config.width - 1; col++) {
        if (previewSwap(s, col, row).cells.length > 0) {
          const m: CoolingMove = { type: "swap", col, row };
          moves.push(m);
          s = COOLING_DEF.reduce(s, m);
          continue outer;
        }
      }
    }
    break;
  }
  return moves;
}

/** The hash after each move, as an honest client records them. */
function hashesOf(seed: string, moves: readonly CoolingMove[]): string[] {
  let s = createCoolingGame(seed, cooling);
  return moves.map((m) => COOLING_DEF.hash((s = COOLING_DEF.reduce(s, m))));
}

const wait = (tick: number): GunneryMove => ({ type: "wait", tick });

describe("replayLog", () => {
  it("replays a log to the same hashes the round recorded", () => {
    const moves = someSwaps("replay-1", 6);
    expect(moves.length).toBeGreaterThan(2);
    const hashes = hashesOf("replay-1", moves);
    const r = replayLog(COOLING_DEF, "replay-1", cooling, moves, { hashes, keepStates: true });
    expect(r.rejection).toBeNull();
    expect(r.divergedAt).toBeNull();
    expect(r.applied).toBe(moves.length);
    expect(r.steps.map((x) => x.hash)).toEqual(hashes);
    expect(r.steps.map((x) => x.seq)).toEqual(moves.map((_, i) => i));
    expect(r.final).toBe(r.steps[r.steps.length - 1]!.state);
    expect(r.summary).toEqual(COOLING_DEF.summarize(r.final));
    expect(r.initialHash).toBe(COOLING_DEF.hash(createCoolingGame("replay-1", cooling)));
  });

  it("keeps no states unless asked, and gives the same final state", () => {
    const moves = someSwaps("replay-2", 4);
    const kept = replayLog(COOLING_DEF, "replay-2", cooling, moves, { keepStates: true });
    const bare = replayLog(COOLING_DEF, "replay-2", cooling, moves);
    expect(bare.steps).toEqual([]);
    expect(bare.applied).toBe(moves.length);
    expect(bare.final).toEqual(kept.final);
  });

  it("finds a divergence where a recorded hash stops matching, and walks on past it", () => {
    const moves = someSwaps("replay-3", 5);
    const hashes = hashesOf("replay-3", moves);
    hashes[2] = "00000000";
    const r = replayLog(COOLING_DEF, "replay-3", cooling, moves, { hashes, keepStates: true });
    expect(r.divergedAt).toBe(2);
    expect(r.rejection).toBeNull();
    expect(r.steps.length).toBe(moves.length);
    // Hashes left out are not compared.
    const sparse = replayLog(COOLING_DEF, "replay-3", cooling, moves, { hashes: [undefined, hashes[1]] });
    expect(sparse.divergedAt).toBeNull();
  });

  it("stops at the first move the engine refuses, as illegal_move with the engine's words, and keeps the states before it", () => {
    const moves = someSwaps("replay-4", 3);
    const bad: CoolingMove[] = [...moves, { type: "swap", col: 99, row: 0 }, ...moves];
    const r = replayLog(COOLING_DEF, "replay-4", cooling, bad, { keepStates: true });
    expect(r.rejection).toMatchObject({ atSeq: moves.length, reason: "illegal_move" });
    expect(r.rejection!.message).toEqual(expect.any(String));
    expect(r.steps.length).toBe(moves.length);
    expect(r.applied).toBe(moves.length);
    expect(r.final).toEqual(replayLog(COOLING_DEF, "replay-4", cooling, moves).final);
  });

  it("refuses a log longer than the engine's cap at the first move past it, as too_many_moves, though the engine would take it", () => {
    // Aboard, the battle's supply comes as moves the engine takes any number of; only the cap stops them.
    const config: BattleConfig = { ...DEFAULT_BATTLE_CONFIG, supply: null, maxMoves: 3 };
    const supply: BattleMove = { type: "supply", left: 1, forward: 1, right: 1, turrets: 1, hull: 0 };
    const log = [supply, supply, supply, supply, supply];
    expect(() => log.reduce((s, m) => BATTLE_DEF.reduce(s, m), BATTLE_DEF.create("replay-5", config))).not.toThrow();
    const r = replayLog(BATTLE_DEF, "replay-5", config, log, { keepStates: true });
    expect(r.rejection).toEqual({ atSeq: 3, reason: "too_many_moves" });
    expect(r.steps.length).toBe(3);
    expect(replayLog(BATTLE_DEF, "replay-5", config, log.slice(0, 3)).rejection).toBeNull();
  });

  it("judges the cap before the engine, as the server does", () => {
    // Gunnery finishes itself after maxMoves, so a fourth move is one the engine refuses too.
    const config: GunneryConfig = { ...DEFAULT_GUNNERY_CONFIG, maxMoves: 3 };
    const r = replayLog(GUNNERY_DEF, "replay-6", config, [wait(1), wait(2), wait(3), wait(4)]);
    expect(r.rejection).toEqual({ atSeq: 3, reason: "too_many_moves" });
  });

  it("refuses a timed move that claims a time past the round's end, as deadline", () => {
    // 200ms ticks in a one-second round: tick 5 is the round's last instant, tick 6 is after it.
    const roundMs = 5 * DEFAULT_GUNNERY_CONFIG.tickMs;
    const log = [wait(2), wait(5), wait(6), wait(7)];
    const r = replayLog(GUNNERY_DEF, "replay-7", DEFAULT_GUNNERY_CONFIG, log, { roundMs, keepStates: true });
    expect(r.rejection).toEqual({ atSeq: 2, reason: "deadline" });
    expect(r.steps.length).toBe(2);
    expect(r.final.tick).toBe(5);
    // Without the round's length nothing is late, and the waits all apply.
    const free = replayLog(GUNNERY_DEF, "replay-7", DEFAULT_GUNNERY_CONFIG, log);
    expect(free.rejection).toBeNull();
    expect(free.final.tick).toBe(7);
  });

  it("judges lateness before the cap, as the server does", () => {
    const config: GunneryConfig = { ...DEFAULT_GUNNERY_CONFIG, maxMoves: 1 };
    const r = replayLog(GUNNERY_DEF, "replay-8", config, [wait(1), wait(50)], { roundMs: 1000 });
    expect(r.rejection).toEqual({ atSeq: 1, reason: "deadline" });
  });

  it("never finds an untimed move late", () => {
    const moves = someSwaps("replay-9", 3);
    expect(replayLog(COOLING_DEF, "replay-9", cooling, moves, { roundMs: 1 }).rejection).toBeNull();
  });

  it("replays a timed engine, waits included", () => {
    const moves: GunneryMove[] = [wait(10), { type: "arrow", col: 4, row: 2, dir: 0, tick: 12 }, wait(60)];
    const r = replayLog(GUNNERY_DEF, "replay-10", DEFAULT_GUNNERY_CONFIG, moves);
    expect(r.rejection).toBeNull();
    expect(r.final.tick).toBe(60);
  });
});

describe("pureMoveRejection", () => {
  const swap: CoolingMove = { type: "swap", col: 0, row: 0 };

  it("judges a move by when it arrived when the judge knows: the round's end plus its grace", () => {
    const clock = { roundMs: 60_000, graceMs: 1000 };
    expect(pureMoveRejection(COOLING_DEF, cooling, 0, swap, { ...clock, atMs: 61_000 })).toBeNull();
    expect(pureMoveRejection(COOLING_DEF, cooling, 0, swap, { ...clock, atMs: 61_001 })).toBe("deadline");
    // A timed move's claim does not stand in for a known arrival time.
    expect(pureMoveRejection(GUNNERY_DEF, DEFAULT_GUNNERY_CONFIG, 0, wait(1_000_000), { ...clock, atMs: 10 })).toBeNull();
    expect(pureMoveRejection(GUNNERY_DEF, DEFAULT_GUNNERY_CONFIG, 0, wait(1), { ...clock, atMs: 61_001 })).toBe("deadline");
  });

  it("counts the moves already logged against the cap", () => {
    const max = COOLING_DEF.maxMoves(cooling);
    expect(pureMoveRejection(COOLING_DEF, cooling, max - 1, swap)).toBeNull();
    expect(pureMoveRejection(COOLING_DEF, cooling, max, swap)).toBe("too_many_moves");
  });
});
