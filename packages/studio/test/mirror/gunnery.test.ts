// The Gunnery page on the new engine is the shipped page with another engine behind it (ADR 0097). This holds
// what that engine hands the board, the whole state and everything heard on the way, to what the shipped
// engine hands it on the same seed: after every stretch of time let pass, every move and every wait.
import { advanceGunnery, DEFAULT_GUNNERY_CONFIG, GUNNERY_DEF, predictGunneryPath, type Dir, type GunneryConfig, type GunneryMove, type GunneryState } from "@openseas/engine";
import { nextInt, seedFromString } from "@openseas/puzzle";
import { describe, expect, it } from "vitest";
import { advanceGunneryMirror, GUNNERY_MIRROR } from "../../src/rungs/mirror/gunnery.js";

const CONFIGS: Record<string, GunneryConfig> = {
  "as shipped": DEFAULT_GUNNERY_CONFIG,
  // A crowded deck with a fast feed makes pieces queue, wait and meet head on, and quick turrets fire broadsides.
  "a fast feed and quick turrets": { ...DEFAULT_GUNNERY_CONFIG, maxOnDeck: 14, spawnEveryTicks: 4, spawnEveryTicksMin: 2, queueLength: 0, bag: [3, 3, 3, 2], fireAfterTicks: 1, stepPoints: 7, loadPoints: 60, comboStep: 15, comboCap: 4, broadsidePoints: 111 },
  // One gangway from the feeder to a hatch with a turret on each side: full loads, loads in a row and broadsides come often.
  "one gangway and two turrets": {
    ...DEFAULT_GUNNERY_CONFIG,
    decks: [["###C###", "B.....H", "####C##", "#######", "#######"]],
    maxTick: 500,
    spawnEveryTicks: 5,
    spawnEveryTicksMin: 5,
    fireAfterTicks: 2,
  },
  "a short round on one deck": { ...DEFAULT_GUNNERY_CONFIG, decks: [DEFAULT_GUNNERY_CONFIG.decks[3]!], maxTick: 300, spawnEveryTicks: 6, spawnEveryTicksMin: 6, queueLength: 5, bag: [1, 1, 1, 0], fireAfterTicks: 9 },
};

/**
 * A move for the shipped round, picked by a stream of the test's own. Most of the time it steers: it looks for
 * one arrow, laid or lifted, that sends a piece somewhere better (into a turret that wants it, or away from one
 * it would jam) and sends no other piece somewhere worse. The rest of the time it lays or lifts any arrow, so
 * that the rounds hold jams, splashes and pieces meeting head on as well.
 */
function pickMove(s: GunneryState, pick: (n: number) => number): { col: number; row: number; dir: 0 | 1 | 2 | 3 } | { col: number; row: number } | null {
  const planks = Array.from({ length: s.deck.cells.length }, (_, i) => ({ col: i % s.deck.width, row: Math.floor(i / s.deck.width) })).filter((c) => s.deck.cells[c.row * s.deck.width + c.col] === "deck");
  type Arrows = GunneryState["arrows"];
  const worth = (piece: GunneryState["pieces"][number], arrows: Arrows): number => {
    const end = predictGunneryPath(s, piece, 40, arrows).end;
    if (end?.type !== "turret") return 1;
    return end.outcome === "loaded" ? 4 : end.outcome === "load" || end.outcome === "clean" ? 3 : 0;
  };
  if (pick(8) > 0) {
    const now = s.pieces.map((piece) => worth(piece, s.arrows));
    const holds = (arrows: Arrows, but: number): boolean => s.pieces.every((piece, i) => i === but || worth(piece, arrows) >= now[i]!);
    for (const [i, piece] of s.pieces.entries()) {
      if (now[i]! >= 3) continue;
      for (const cell of [{ col: piece.col, row: piece.row }, ...predictGunneryPath(s, piece, 14).cells]) {
        const rest = s.arrows.filter((a) => a.col !== cell.col || a.row !== cell.row);
        if (rest.length < s.arrows.length && worth(piece, rest) > now[i]! && holds(rest, i)) return cell;
        for (const dir of [0, 1, 2, 3] as const) {
          const laid = [...rest, { ...cell, dir }];
          if (worth(piece, laid) > now[i]! && holds(laid, i)) return { ...cell, dir };
        }
      }
    }
    // Nothing to steer: an arrow no piece on deck needs is lifted, so it turns nothing that comes later.
    const spare = s.arrows.find((a) => holds(s.arrows.filter((b) => b !== a), -1));
    return spare ? { col: spare.col, row: spare.row } : null;
  }
  const at = planks[pick(planks.length)]!;
  const lift = s.arrows.length > 0 && pick(3) === 0 ? s.arrows[pick(s.arrows.length)]! : null;
  return lift ? { col: lift.col, row: lift.row } : { ...at, dir: pick(4) as 0 | 1 | 2 | 3 };
}

describe("the Gunnery board's state from the new engine, beside the shipped engine's", () => {
  const met: Record<string, number> = {};
  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`is the same state and the same events, tick for tick: ${name}`, () => {
      for (let seed = 1; seed <= 5; seed++) {
        let shipped = GUNNERY_DEF.create(`seed-${seed}`, config);
        let mirror = GUNNERY_MIRROR.create(`seed-${seed}`, config);
        // The same seed deals the same deck and the same feed.
        expect(mirror).toEqual(shipped);
        let picks = seedFromString(`picks-${seed}`);
        const pick = (n: number): number => {
          const r = nextInt(picks, n);
          picks = r.state;
          return r.value;
        };
        const both = (move: GunneryMove, at: string): void => {
          shipped = GUNNERY_DEF.reduce(shipped, move);
          mirror = GUNNERY_MIRROR.reduce(mirror, move);
          expect(mirror, at).toEqual(shipped);
          expect(GUNNERY_MIRROR.hash(mirror), at).toBe(GUNNERY_DEF.hash(shipped));
          for (const e of shipped.lastMove!.events) met[e.type] = (met[e.type] ?? 0) + 1;
        };
        for (let tick = 0; tick < config.maxTick - 6; ) {
          tick += 1 + pick(4);
          const at = `${name}, seed ${seed}, tick ${tick}`;
          // What the board shows while time passes, with nothing logged: it is asked from the last logged state, again and again.
          expect(advanceGunneryMirror(mirror, tick), at).toEqual(advanceGunnery(shipped, tick));
          const move = pick(6) === 0 ? null : pickMove(advanceGunnery(shipped, tick), pick);
          if (!move) {
            if (pick(3) === 0) both({ type: "wait", tick }, at);
            continue;
          }
          both("dir" in move ? { type: "arrow", col: move.col, row: move.row, dir: move.dir as Dir, tick } : { type: "remove", ...move, tick }, at);
        }
        // The round runs out on a last wait, as the page sends one.
        both({ type: "wait", tick: config.maxTick }, `${name}, seed ${seed}, the end`);
        expect(mirror.finished).toBe(true);
        expect(() => GUNNERY_MIRROR.reduce(mirror, { type: "wait", tick: config.maxTick })).toThrow();
      }
    });
  }
  // The comparison means something only if the rules were met.
  it("met every event on the way", () => {
    for (const what of ["spawn", "load", "loaded", "jam", "clean", "splash", "exit", "fire", "broadside"]) expect(met[what], what).toBeGreaterThan(0);
  });
});
