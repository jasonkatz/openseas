// Navigation, a ticking puzzle on a ring board, played beside the engine the game ships. Both are dealt from the same
// luck, and are held to the same chart, markers, sky, score and streak after every stretch of ticks and every move.
import { advanceNavigation, createNavigationGame, DEFAULT_NAVIGATION_CONFIG, navigationHint, reduceNavigation, type NavigationConfig, type NavigationMove, type NavigationState } from "@openseas/engine";
import { describe, expect, it } from "vitest";
import navigation, { type DropMove, type Sky, type TurnMove } from "../examples/navigation.puzzle.js";
import { advance, expand, explain, nextInt, play, read, replay, seedFromString, start, view, type Round, type Setting } from "../src/index.js";

type Move = TurnMove | DropMove;
const TICK = 100;
const SEEDS = Number(process.env.SEEDS ?? 6);
/** Hands the event loop back for a moment. */
const breathe = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

const settingsOf = (c: NavigationConfig): Record<string, Setting> => ({
  rings: c.rings,
  sectors: c.octants,
  shapes: c.shapes,
  colors: c.colors,
  startStars: c.startStars,
  mostStars: c.maxStars,
  reusePercent: c.reuseChancePercent,
  starPoints: c.starPoints,
  chainPercent: c.chainPercent,
  runPoints: c.runPoints,
  lostPoints: -c.lostHeadingPenalty,
  roundSeconds: (c.maxTick * c.tickMs) / 1000,
  maxMoves: c.maxMoves,
  fallTicks: c.fallTicks,
  fallTicksLeast: c.fallTicksMin,
});
const CONFIGS: Record<string, NavigationConfig> = {
  "as shipped": DEFAULT_NAVIGATION_CONFIG,
  // Few kinds and a fast sky: runs, lost headings and constellations charted in a row all come often.
  "few kinds and a fast sky": { ...DEFAULT_NAVIGATION_CONFIG, shapes: 2, colors: 2, fallTicks: 12, fallTicksMin: 4, startStars: 2, maxStars: 5, reuseChancePercent: 80, chainPercent: [100, 133, 166], lostHeadingPenalty: 25 },
  "four rings of six": { ...DEFAULT_NAVIGATION_CONFIG, rings: 4, octants: 6, shapes: 2, colors: 3, fallTicks: 20, fallTicksMin: 9, runPoints: 7 },
};

/** The shipped chart as the new board holds it: ring by ring from the innermost, a star's kind counted from 1. */
const shippedChart = (s: NavigationState): (number | null)[][] => Array.from({ length: s.config.rings }, (_, r) => Array.from({ length: s.config.octants }, (_, o) => (s.slots[r * s.config.octants + o] ? s.slots[r * s.config.octants + o]!.kind + 1 : null)));
const shippedMarkers = (s: NavigationState): (number | null)[][] => {
  const out: (number | null)[][] = Array.from({ length: s.config.rings }, () => Array.from({ length: s.config.octants }, () => null));
  for (const m of s.markers) out[m.ring]![m.octant] = m.kind + 1;
  return out;
};

describe("Navigation on the new engine, beside the engine the game ships", () => {
  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`holds the same chart, markers, sky, score and streak, tick for tick: ${name}`, async () => {
      const seen = { moves: 0, charted: 0, runs: 0, lost: 0, drops: 0, chain: 0, efficient: 0, apart: 0 };
      for (let seed = 1; seed <= SEEDS; seed++) {
        // Each seed is seconds of work: let the worker answer its runner between them, or the runner times out.
        await breathe();
        let shipped = createNavigationGame(`seed-${seed}`, config);
        let round: Round<Move> = start(navigation, { seed, settings: settingsOf(config), streams: { sky: seedFromString(`navigation:seed-${seed}`) } });
        let picks = seedFromString(`picks-${seed}`);
        const pick = (n: number): number => {
          const r = nextInt(picks, n);
          picks = r.state;
          return r.value;
        };
        const level = (where: string): void => {
          const now = read(round);
          const sky = (now.state as { sky: Sky }).sky;
          expect(sky.falling, where).toEqual({ kind: shipped.falling.kind, start: shipped.falling.startTick, land: shipped.falling.landTick });
          expect(sky.next, where).toBe(shipped.next);
          expect(now.board.map((r) => r.map((p) => p?.kind ?? null)), where).toEqual(shippedChart(shipped));
          expect(now.ground.map((r) => r.map((g) => (g ? Number(g.state!.slice(5)) : null))), where).toEqual(shippedMarkers(shipped));
          expect(now.streak, where).toBe(shipped.combo);
          // The shipped engine rounds each constellation down. The loop rounds once an entry, so it is never behind.
          expect(now.score - shipped.score, where).toBeGreaterThanOrEqual(0);
          expect(now.score - shipped.score, where).toBeLessThanOrEqual(seen.apart);
          expect(now.stats, where).toMatchObject({ landings: shipped.landings, since_deal: shipped.landingsSinceDeal, lost: shipped.lostHeadings, charted: shipped.completed, runs: shipped.runsCleared });
        };
        level(`seed ${seed}, the deal`);
        let tick = 0;
        const last = config.maxTick - 50;
        for (let m = 0; tick < last; m++) {
          tick = Math.min(last, tick + 1 + pick(pick(6) === 0 ? 20 : 3));
          const where = `seed ${seed}, tick ${tick}`;
          // Mostly the turn the shipped hint gives, so constellations are charted. Now and then any turn, a drop or a wait.
          const helps = navigationHint(advanceNavigation(shipped, tick));
          const kind = pick(12);
          const move: NavigationMove | null =
            helps && kind > 2 ? { type: "rotate", ring: helps.ring, dir: helps.dir, tick } : kind === 0 ? { type: "rotate", ring: pick(config.rings), dir: pick(2) === 0 ? 1 : -1, tick } : kind === 1 || (!helps && kind > 8) ? { type: "drop", tick } : null;
          if (!move) {
            // Time passes with no move: the shipped engine is told so, and the new round lets it pass.
            shipped = advanceNavigation(shipped, tick);
            round = advance(round, { at: tick * TICK });
          } else {
            const before = shipped.score;
            shipped = reduceNavigation(shipped, move);
            round = play(round, move.type === "drop" ? { move: "drop" } : { move: "turn", ring: move.ring, dir: move.dir }, { at: tick * TICK });
            expect(round.last.refused, where).toBeNull();
            if (move.type === "drop") seen.drops++;
            seen.moves++;
            void before;
          }
          for (const e of shipped.lastMove?.events ?? []) {
            if (e.type === "charted") {
              seen.charted++;
              if (e.completion.chainPercent % 100 !== 0) seen.apart++;
              if (e.completion.efficient) seen.efficient++;
              seen.chain = Math.max(seen.chain, e.completion.chain);
            }
            if (e.type === "run") seen.runs++;
            if (e.type === "lost_heading") seen.lost++;
          }
          level(where);
        }
      }
      // The comparison means something only if the rounds reached every rule.
      expect(seen.charted, "constellations charted").toBeGreaterThan(3);
      expect(seen.runs, "runs").toBeGreaterThan(0);
      expect(seen.lost, "lost headings").toBeGreaterThan(0);
      // A fast sky with few kinds is where constellations are charted in a row, and with landings to spare.
      if (name === "few kinds and a fast sky") expect(seen.chain, "charted in a row").toBeGreaterThan(1), expect(seen.efficient, "charted with landings to spare").toBeGreaterThan(0), expect(seen.apart, "chains that round").toBeGreaterThan(0);
    }, 180_000);
  }
});

describe("Navigation as a puzzle of its own", () => {
  it("plays on a ring board, where a ring wraps", () => {
    const round = start(navigation, { seed: 1 });
    const board = view(round).board;
    expect([board.rings, board.sectors]).toEqual([3, 8]);
    expect(board.touching({ x: 0, y: 0 })).toEqual([{ x: 0, y: 1 }, { x: 1, y: 0 }, { x: 7, y: 0 }]);
    expect(board.touching({ x: 7, y: 2 })).toEqual([{ x: 0, y: 2 }, { x: 7, y: 1 }, { x: 6, y: 2 }]);
  });

  it("deals, plays and replays from its seed, settings and log", () => {
    for (let seed = 1; seed <= 3; seed++) {
      let round = start(navigation, { seed });
      for (let m = 0; m < 60; m++) round = play(round, m % 5 === 4 ? { move: "drop" } : { move: "turn", ring: m % 3, dir: m % 2 === 0 ? 1 : -1 }, { at: m * 700 });
      expect(read(round).stats.landings).toBeGreaterThan(10);
      expect(replay(navigation, String(seed), {}, round.log).state).toEqual(round.state);
    }
  });

  it("refuses a ring the chart does not have", () => {
    expect(play(start(navigation, { seed: 1 }), { move: "turn", ring: 3, dir: 1 }).last.refused).toBe("reason.no_ring");
  });

  it("is all there to read: its scoring declared, each hook explained", () => {
    const doc = JSON.parse(expand(navigation)) as { board: unknown; payouts: { id: string }[]; multipliers: { id: string }[]; streak: unknown; round: { tempo: unknown } };
    expect(doc.board).toEqual({ shape: "rings", rings: "rings", sectors: "sectors" });
    expect(doc.round.tempo).toEqual({ kind: "ticking", tickMs: 100 });
    expect(doc.payouts.map((p) => p.id)).toEqual(["stars", "spare", "run", "lost"]);
    expect(doc.streak).toEqual({ builds: { event: "charted" }, counts: "events", grace: 0, breaksOn: ["lost"] });
    expect(explain(navigation)).toMatchInlineSnapshot(`
      "onStart    sky, then chart   [every part, in the order listed]
      canMove    turning (turn)
      onMove     sky (drop), then turning (turn)   [every part with a say on the move, in order]
      onCascade  chart
      onMoveEnd  sky
      onTick     sky
      listMoves  sky, then turning   [every part's moves, in order]"
    `);
  });
});
