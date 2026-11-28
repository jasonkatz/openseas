import fc from "fast-check";
import { describe, expect, it } from "vitest";
import flat from "../examples/swap.flat.js";
import sparks from "../examples/sparks.puzzle.js";
import swap from "../examples/swap.puzzle.js";
import { budget, expand, explain, grid, groupsOf, hint, lines, listMoves, part, play, puzzle, read, refill, replay, seenAfter, seenEmpty, start, swap as swapPart, view, type AnyMove, type Puzzle, type Round } from "../src/index.js";

/** Plays a round to its end: a listed move picked by `pick`, or the hint, so runs differ and still score. */
function playOut<M extends AnyMove>(p: Puzzle<M>, seed: number | string, picks: readonly number[] = [], settings: Record<string, number> = {}): Round<M>[] {
  const rounds = [start(p, { seed, settings })];
  for (let i = 0; !read(rounds.at(-1)!).ended; i++) {
    const r = rounds.at(-1)!;
    const all = listMoves(r);
    const pick = picks.length ? picks[i % picks.length]! : i * 13 + 7;
    const move = i % 3 === 0 ? all[pick % all.length]! : (hint(r) ?? all[0]!);
    rounds.push(play(r, move));
  }
  return rounds;
}
const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

// Determinism first (ADR 0003): the same seed, settings and log always make the same round.
describe("determinism", () => {
  const settings = fc.record({ width: fc.integer({ min: 4, max: 8 }), height: fc.integer({ min: 4, max: 8 }), kinds: fc.integer({ min: 3, max: 6 }), moves: fc.integer({ min: 1, max: 12 }) });

  it("replays the same round from its seed, settings and log", () => {
    fc.assert(
      fc.property(fc.string(), settings, fc.array(fc.nat(), { minLength: 1, maxLength: 12 }), (seed, given, picks) => {
        const last = playOut(swap, seed, picks, given).at(-1)!;
        const again = replay(swap, seed, given, last.log);
        expect(again.state).toEqual(last.state);
        expect(again.last).toEqual(last.last);
        expect(read(again)).toEqual(read(last));
      }),
      { numRuns: 60 },
    );
  });

  it("never changes the round it is given", () => {
    fc.assert(
      fc.property(fc.string(), fc.nat(), (seed, pick) => {
        const r = start(swap, { seed });
        const before = JSON.stringify(r.state);
        const all = listMoves(r);
        play(r, all[pick % all.length]!);
        hint(r);
        expect(JSON.stringify(r.state)).toBe(before);
      }),
      { numRuns: 60 },
    );
  });

  it("gives each draw a stream of its own: asking one for more never moves another", () => {
    // Sparks draws from two streams at the end of a move that Swap does not have. The board Swap
    // and Sparks open on comes from "fill" alone, so it is the same for both.
    for (const seed of SEEDS.slice(0, 20)) expect(read(start(sparks, { seed })).board).toEqual(read(start(swap, { seed })).board);
  });

  it("does not let a tried move show or shift the luck to come", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const r = start(swap, { seed });
      const move = hint(r)!;
      for (let i = 0; i < 5; i++) hint(r);
      expect(play(r, move).state).toEqual(play(start(swap, { seed }), move).state);
    }
  });
});

describe("rung 0 and 1: the seven-line Swap", () => {
  it("plays a whole round and ends on its budget", () => {
    const rounds = playOut(swap, 7);
    const end = read(rounds.at(-1)!);
    expect(end.ended).toBe("moves");
    expect(end.movesMade).toBe(20);
    expect(end.score).toBeGreaterThan(0);
    expect(end.board.flat().every(Boolean)).toBe(true);
    expect(play(rounds.at(-1)!, rounds.at(-1)!.log[0]!.move).last.refused).toBe("reason.round_over");
  });

  it("refuses a move with the rules' own reason, and changes nothing", () => {
    const r = start(swap, { seed: 1 });
    const far = play(r, { move: "swap", a: { x: 0, y: 0 }, b: { x: 3, y: 3 } });
    expect(far.last.refused).toBe("reason.side_by_side");
    expect(far.state).toBe(r.state);
    expect(far.log).toBe(r.log);
    expect(play(r, { move: "swap", a: { x: 0, y: 0 }, b: { x: -1, y: 0 } }).last.refused).toBe("reason.off_board");
  });

  it("refuses a setting out of its bounds, and one the puzzle does not declare", () => {
    expect(() => start(swap, { seed: 1, settings: { kinds: 99 } })).toThrow("setting kinds: 99 is outside 2 to 8");
    expect(() => start(swap, { seed: 1, settings: { speed: 3 } })).toThrow("setting speed is not declared");
  });

  it("knows its moves by type", () => {
    const r = start(swap, { seed: 1 });
    // @ts-expect-error swap has no move called trace
    play(r, { move: "trace", path: [] });
    // @ts-expect-error a swap needs b
    play(r, { move: "swap", a: { x: 0, y: 0 } });
  });

  it("pays one point for each piece cleared, by default", () => {
    for (const r of playOut(swap, 11).slice(1)) {
      for (const e of r.last.events) if (e.event === "clear") expect(e.points).toBe((e.fields.pieces as unknown[]).length);
    }
    const rounds = playOut(swap, 11);
    const paid = rounds.flatMap((r) => r.last.events).reduce((n, e) => n + (e.points ?? 0), 0);
    expect(read(rounds.at(-1)!).score).toBe(paid);
  });
});

describe("the deal's check, held by the loop", () => {
  it("opens every round with no line standing and a move worth making, shown as one event", () => {
    for (const seed of SEEDS) {
      const r = start(swap, { seed });
      expect(r.last.events.map((e) => e.event)).toEqual(["fill"]);
      expect(read(r).score).toBe(0);
      expect(hint(r), `seed ${seed}`).not.toBeNull();
    }
  });

  it("never leaves a board with no move worth making", () => {
    let again = 0;
    for (const seed of SEEDS.slice(0, 60)) {
      for (const r of playOut(swap, seed, [], { kinds: 8, width: 4, height: 4 })) {
        if (!read(r).ended) expect(hint(r), `seed ${seed}`).not.toBeNull();
        again += r.last.events.filter((e) => e.event === "reshuffle").length;
      }
    }
    // A small board of many kinds runs out of moves often, so the check that holds during play is exercised.
    expect(again).toBeGreaterThan(0);
  });

  it("asks the fallback when every try fails, and takes what it deals", () => {
    // Lines of six on a board of eight kinds almost never deal a move, so the fallback deals.
    let fell = 0;
    for (const seed of SEEDS.slice(0, 8)) {
      const hard = puzzle("hard", { board: grid(6, 7), pieces: 8, parts: [swapPart(), lines(6), refill()], ends: budget(3) });
      const r = start(hard, { seed });
      expect(groupsOf(viewBoard(r), 6)).toEqual([]);
      expect(hint(r)).not.toBeNull();
      const kinds = new Set(read(r).board.flat().map((p) => p!.kind));
      if (kinds.size === 2) fell++;
      expect(read(playOut(hard, seed).at(-1)!).ended).toBe("moves");
    }
    expect(fell).toBeGreaterThan(0);
  });

  it("refuses to start, naming the check, when every try fails and there is no fallback", () => {
    const { onFallback: _, ...hooks } = refill().hooks;
    const bare = part({ ...refill(), hooks });
    const hard = puzzle("hard", { board: grid(3, 3), pieces: 8, parts: [swapPart(), lines(3), bare], ends: budget(3) });
    const failed = SEEDS.slice(0, 40).filter((seed) => {
      try {
        start(hard, { seed, settings: { lineMin: 6 } });
        return false;
      } catch (e) {
        expect(String(e)).toContain("check playable: no deal passed in 50 tries, and the rules have no onFallback");
        return true;
      }
    });
    expect(failed.length).toBeGreaterThan(0);
  });

  it("refuses a puzzle that declares a check and cannot list its moves", () => {
    const { listMoves: _, ...hooks } = swapPart().hooks;
    const mute = puzzle("mute", { board: grid(6, 7), pieces: 5, parts: [part({ ...swapPart(), hooks }), lines(3), refill()], ends: budget(3) });
    expect(() => start(mute, { seed: 1 })).toThrow("mute declares the check playable, so its rules must answer listMoves");
  });
});

const viewBoard = (r: Round): Parameters<typeof groupsOf>[0] => view(r).board;

describe("a board drawn from events alone", () => {
  it("holds what the round holds after every event of every round", () => {
    for (const p of [swap, sparks] as Puzzle[]) {
      for (const seed of SEEDS.slice(0, 40)) {
        const rounds = playOut(p, seed);
        const first = read(rounds[0]!).board;
        let seen = seenEmpty(first[0]!.length, first.length);
        for (const r of rounds) {
          for (const e of r.last.events) seen = seenAfter(seen, e);
          expect(seen, `seed ${seed}, move ${r.log.length}`).toEqual(read(r).board);
        }
      }
    }
  });
});

describe("nothing is hidden", () => {
  it("expands to a whole document, the same every time", () => {
    const doc = JSON.parse(expand(swap)) as Record<string, unknown>;
    expect(Object.keys(doc)).toEqual(["id", "version", "history", "mechanic", "verb", "round", "board", "terrain", "zones", "settings", "relations", "deal", "layers", "ladder", "signals", "pieces", "moves", "controls", "events", "payouts", "multipliers", "tasks", "gauges", "stats", "texts", "teaching"]);
    expect((doc.settings as { id: string }[]).map((s) => s.id)).toEqual(["width", "height", "kinds", "moves", "lineMin"]);
    expect(expand(swap)).toBe(expand(puzzle("swap", { board: grid(6, 7), pieces: 5, parts: [swapPart(), lines(3), refill()], ends: budget(20) })));
  });

  it("explains which part answers each hook, in order", () => {
    expect(explain(swap)).toMatchInlineSnapshot(`
      "onStart    refill
      onFallback refill
      canMove    swap (swap)
      onMove     swap (swap)
      onCascade  lines, then refill   [parts in order: the first to report anything ends the step]
      listMoves  swap"
    `);
  });

  it("the rules written flat, by hand, report the same events as the three parts, on every seed", () => {
    let events = 0;
    for (const seed of SEEDS.slice(0, 80)) {
      const composed = playOut(swap, seed);
      let other = start(flat, { seed });
      expect(other.last.events).toEqual(composed[0]!.last.events);
      for (const r of composed.slice(1)) {
        other = play(other, r.log.at(-1)!.move);
        expect(other.last.events, `seed ${seed}, move ${r.log.length}`).toEqual(r.last.events);
        events += r.last.events.length;
      }
      expect(read(other)).toEqual(read(composed.at(-1)!));
    }
    expect(events).toBeGreaterThan(4_000);
  });
});

describe("how parts merge", () => {
  it("names both parts when two declare the same thing", () => {
    expect(() => puzzle("twice", { board: grid(6, 7), pieces: 5, parts: [swapPart(), lines(3), lines(4), refill()], ends: budget(20) })).toThrow('setting "lineMin" is declared by both lines and lines');
  });

  it("refuses a puzzle with no move", () => {
    expect(() => puzzle("still", { board: grid(6, 7), pieces: 5, parts: [lines(3), refill()], ends: budget(20) })).toThrow("still has no move: add a part that brings one");
  });

  it("for lines and refill the order does not matter: refill listed first plays the same", () => {
    const other = puzzle("swap", { board: grid(6, 7), pieces: 5, parts: [swapPart(), refill(), lines(3)], ends: budget(20) });
    const a = playOut(swap, 3).at(-1)!;
    expect(replay(other, a.seed, {}, a.log).last.events).toEqual(a.last.events);
  });

  it("an author's own part plays beside the stock ones", () => {
    let bursts = 0;
    let charges = 0;
    for (const seed of SEEDS.slice(0, 80)) {
      const rounds = playOut(sparks, seed);
      expect(read(rounds.at(-1)!).ended).toBe("moves");
      for (const r of rounds) for (const e of r.last.events) (e.event === "burst" && bursts++, e.event === "charge" && charges++);
      expect(replay(sparks, rounds.at(-1)!.seed, {}, rounds.at(-1)!.log).state).toEqual(rounds.at(-1)!.state);
    }
    expect(charges).toBeGreaterThan(0);
    expect(bursts).toBeGreaterThan(0);
  });
});
