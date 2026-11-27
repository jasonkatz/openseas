// THROWAWAY SPIKE. These are the spike's questions, asked as tests.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { check } from "../../docs/src/api/schema/check.js";
import { PUZZLE } from "../../docs/src/api/schema/puzzle.js";
import { isPage, type Field, type RootObject, type Type } from "../../docs/src/api/schema/types.js";
import flat from "../examples/expanded/swap.rules.js";
import sparks from "../examples/sparks.puzzle.js";
import swap from "../examples/swap.puzzle.js";
import { budget, expand, grid, hint, lines, listMoves, play, puzzle, read, refill, replay, start, swap as swapPart, type AnyMove, type Puzzle, type Round } from "../src/index.js";

/** Plays a round to its end: the hint when there is one, else a listed move, picked by a counter so runs differ. */
function playOut<M extends AnyMove>(p: Puzzle<M>, seed: number): Round<M>[] {
  const rounds = [start(p, { seed })];
  for (let i = 0; !read(rounds.at(-1)!).ended; i++) {
    const r = rounds.at(-1)!;
    const all = listMoves(r);
    const move = i % 3 === 0 ? all[(seed * 7 + i * 13) % all.length]! : (hint(r) ?? all[0]!);
    rounds.push(play(r, move));
  }
  return rounds;
}
const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

describe("rung 0 and 1: the seven-line Swap", () => {
  it("plays a whole round and ends on its budget", () => {
    const rounds = playOut(swap, 7);
    const end = read(rounds.at(-1)!);
    expect(end.ended).toBe("moves");
    expect(end.movesMade).toBe(20);
    expect(end.score).toBeGreaterThan(0);
    expect(end.board.flat().every(Boolean)).toBe(true);
  });

  it("refuses a move with the rules' own reason, and changes nothing", () => {
    const r = start(swap, { seed: 1 });
    const far = play(r, { move: "swap", a: { x: 0, y: 0 }, b: { x: 3, y: 3 } });
    expect(far.last.refused).toBe("pick two pieces side by side");
    expect(far.state).toBe(r.state);
    expect(play(r, { move: "swap", a: { x: 0, y: 0 }, b: { x: -1, y: 0 } }).last.refused).toBe("b is not a place on the board");
  });

  it("opens every round settled and with a move to make", () => {
    for (const seed of SEEDS) {
      const r = start(swap, { seed });
      expect(r.last.events.map((e) => e.event)).toEqual(["fill"]);
      expect(hint(r), `seed ${seed}`).not.toBeNull();
    }
  });

  it("replays the same from its seed, settings and log", () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const last = playOut(swap, seed).at(-1)!;
      expect(replay(swap, last.seed, {}, last.log).state).toEqual(last.state);
    }
  });

  it("knows its moves by type", () => {
    const r = start(swap, { seed: 1 });
    // @ts-expect-error swap has no move called trace
    play(r, { move: "trace", path: [] });
    // @ts-expect-error a swap needs b
    play(r, { move: "swap", a: { x: 0, y: 0 } });
  });
});

describe("the expansion promise", () => {
  it("expand prints the document kept beside the puzzle", () => {
    expect(expand(swap).document).toBe(readFileSync(new URL("../examples/expanded/swap.puzzle.json", import.meta.url), "utf8"));
  });

  it("the hand-written flat rules report the same events as the three parts, on every seed", () => {
    let events = 0;
    for (const seed of SEEDS) {
      const composed = playOut(swap, seed);
      let other = start(flat, { seed });
      expect(other.last.events).toEqual(composed[0]!.last.events);
      for (const r of composed.slice(1)) {
        other = play(other, r.log.at(-1)!);
        expect(other.last.events, `seed ${seed}, move ${r.log.length}`).toEqual(r.last.events);
        events += r.last.events.length;
      }
      expect(read(other)).toEqual(read(composed.at(-1)!));
    }
    console.log(`compared ${events} events over ${SEEDS.length} rounds`);
  });

  it("is held to the docs site's reference for a puzzle document", () => {
    const typeOf = (root: RootObject): Type => ({ kind: "object", fields: root.groups.flatMap((g) => g.fields.map((f): Field => (isPage(f) ? { name: f.key, type: f.type, need: f.need, description: f.lede } : f))) });
    const problems = check(swap.document, typeOf(PUZZLE), "swap");
    console.log(problems.length ? problems.join("\n") : "no problems");
    expect(problems).toMatchSnapshot();
  });
});

describe("how parts merge", () => {
  it("names both parts when two declare the same thing", () => {
    expect(() => puzzle("twice", { board: grid(6, 7), pieces: 5, parts: [swapPart(), lines(3), lines(4), refill()], ends: budget(20) })).toThrow('setting "lineMin" is declared by both lines and lines');
  });

  it("for these two the order does not matter: refill listed before lines plays the same", () => {
    const other = puzzle("swap", { board: grid(6, 7), pieces: 5, parts: [swapPart(), refill(), lines(3)], ends: budget(20) });
    const a = playOut(swap, 3).at(-1)!;
    expect(replay(other, a.seed, {}, a.log).last.events).toEqual(a.last.events);
  });

  it("an author's own part plays beside the stock ones", () => {
    let bursts = 0, charges = 0;
    for (const seed of SEEDS) {
      const rounds = playOut(sparks, seed);
      expect(read(rounds.at(-1)!).ended).toBe("moves");
      for (const r of rounds) for (const e of r.last.events) (e.event === "burst" && bursts++, e.event === "charge" && charges++);
      expect(replay(sparks, rounds.at(-1)!.seed, {}, rounds.at(-1)!.log).state).toEqual(rounds.at(-1)!.state);
    }
    console.log(`sparks: ${charges} charges, ${bursts} bursts over ${SEEDS.length} rounds`);
    expect(charges).toBeGreaterThan(0);
    expect(bursts).toBeGreaterThan(0);
  });
});
