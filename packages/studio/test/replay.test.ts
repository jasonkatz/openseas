import { describe, expect, it } from "vitest";
import { COOLING_DEF, GUNNERY_DEF, createCoolingGame, previewSwap, type CoolingMove, type GunneryMove } from "@openseas/engine";
import { loadContent } from "@openseas/content";
import { replayAgrees, replayRound } from "../src/studio/replay.js";

const content = loadContent();
const cooling = content.puzzles.cooling.config;
const gunnery = content.puzzles.gunnery.config;

/** A handful of legal Cooling swaps for a seed: the first swap that clears something in each row, or any legal one. */
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

describe("replayRound", () => {
  it("replays a log to the same hashes the round recorded", () => {
    const moves = someSwaps("review-1", 6);
    expect(moves.length).toBeGreaterThan(2);
    let s = createCoolingGame("review-1", cooling);
    const hashes = moves.map((m) => COOLING_DEF.hash((s = COOLING_DEF.reduce(s, m))));
    const r = replayRound(COOLING_DEF, "review-1", cooling, moves, hashes);
    expect(r.error).toBeNull();
    expect(r.divergedAt).toBeNull();
    expect(replayAgrees(r)).toBe(true);
    expect(r.steps.map((x) => x.hash)).toEqual(hashes);
    expect(r.summary).toEqual(COOLING_DEF.summarize(s));
    expect(r.initialHash).toBe(COOLING_DEF.hash(createCoolingGame("review-1", cooling)));
  });

  it("reports where recorded hashes stop matching", () => {
    const moves = someSwaps("review-2", 5);
    let s = createCoolingGame("review-2", cooling);
    const hashes = moves.map((m) => COOLING_DEF.hash((s = COOLING_DEF.reduce(s, m))));
    hashes[2] = "00000000";
    const r = replayRound(COOLING_DEF, "review-2", cooling, moves, hashes);
    expect(r.divergedAt).toBe(2);
    expect(replayAgrees(r)).toBe(false);
    expect(r.steps.length).toBe(moves.length);
  });

  it("stops at the first move the engine refuses and keeps the states before it", () => {
    const moves = someSwaps("review-3", 3);
    const bad: CoolingMove[] = [...moves, { type: "swap", col: 99, row: 0 }, ...moves];
    const r = replayRound(COOLING_DEF, "review-3", cooling, bad);
    expect(r.error?.atSeq).toBe(moves.length);
    expect(r.steps.length).toBe(moves.length);
  });

  it("replays a timed engine, waits included", () => {
    const moves: GunneryMove[] = [
      { type: "wait", tick: 10 },
      { type: "arrow", col: 4, row: 2, dir: 0, tick: 12 },
      { type: "wait", tick: 60 },
    ];
    const r = replayRound(GUNNERY_DEF, "review-4", gunnery, moves);
    expect(r.error).toBeNull();
    expect(r.final.tick).toBe(60);
  });
});
