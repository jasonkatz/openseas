import { describe, expect, it } from "vitest";
import { COOLING_DEF, GUNNERY_DEF, createCoolingGame, previewSwap, type CoolingMove, type GunneryMove } from "@openseas/engine";
import { loadContent } from "@openseas/content";
import { findSeed, replayRound } from "../src/review/replay.js";
import { parseRoundFile } from "../src/review/roundFile.js";

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

describe("findSeed", () => {
  it("finds a seed whose opening board satisfies the probe, or none within the tries", () => {
    const seed = findSeed(COOLING_DEF, cooling, (s) => s.cells.some((p) => p.kind >= 100), "probe", 500);
    expect(seed).not.toBeNull();
    expect(createCoolingGame(seed!, cooling).cells.some((p) => p.kind >= 100)).toBe(true);
    expect(findSeed(COOLING_DEF, cooling, () => false, "never", 3)).toBeNull();
  });
});

describe("parseRoundFile", () => {
  const moves = someSwaps("file-1", 3);

  it("reads a bench export", () => {
    const text = JSON.stringify({ kind: "openseas.round", version: 1, puzzle: "cooling", seed: "file-1", config: cooling, moves, hashes: ["a", "b", "c"], roundSeconds: 60 });
    const r = parseRoundFile(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.round.moves).toEqual(moves);
    expect(r.round.hashes).toEqual(["a", "b", "c"]);
    expect(r.round.roundSeconds).toBe(60);
    expect(r.notes).toEqual([]);
  });

  it("reads a database row and says what it filled in", () => {
    const r = parseRoundFile(JSON.stringify({ id: "x", puzzle: "cooling", seed: "file-1", move_log: moves, score: 3 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.round.config).toBeUndefined();
    expect(r.notes.sort()).toEqual(["config_from_content", "moves_from_row"]);
  });

  it("refuses what the server would refuse", () => {
    expect(parseRoundFile("nope")).toEqual({ ok: false, error: "not_json" });
    expect(parseRoundFile("[]")).toEqual({ ok: false, error: "not_object" });
    expect(parseRoundFile(JSON.stringify({ puzzle: "chess", seed: "s", moves: [] }))).toEqual({ ok: false, error: "no_puzzle" });
    expect(parseRoundFile(JSON.stringify({ puzzle: "cooling", moves: [] }))).toEqual({ ok: false, error: "no_seed" });
    expect(parseRoundFile(JSON.stringify({ puzzle: "cooling", seed: "s" }))).toEqual({ ok: false, error: "no_moves" });
    // A Gunnery arrow is not a Cooling move, and a swap with a stray field is not a move either.
    expect(parseRoundFile(JSON.stringify({ puzzle: "cooling", seed: "s", moves: [{ type: "arrow", col: 1, row: 1, dir: 0, tick: 1 }] }))).toEqual({ ok: false, error: "bad_move:0" });
    expect(parseRoundFile(JSON.stringify({ puzzle: "cooling", seed: "s", moves: [moves[0], { type: "swap", col: 1, row: 1, extra: true }] })).ok).toBe(true);
  });
});
