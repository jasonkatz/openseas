// Engines, played beside the engine the game ships. Both are dealt from the same luck, and are held to the same
// core, injectors, pairs, score and streak after every pair.
import { createEnginesGame, DEFAULT_ENGINES_CONFIG, enginesRestingPlacements, reduceEngines, type EnginesConfig, type EnginesState } from "@openseas/engine";
import { describe, expect, it } from "vitest";
import engines, { rests, type Pair, type PlaceMove } from "../examples/engines.puzzle.js";
import { expand, explain, hint, nextInt, play, read, replay, seedFromString, start, view, type Round, type Setting } from "../src/index.js";

const SEEDS = Number(process.env.SEEDS ?? 4);
const PAIRS = Number(process.env.PAIRS ?? 150);

const settingsOf = (c: EnginesConfig): Record<string, Setting> => ({
  width: c.width,
  height: c.height,
  kinds: c.pieceKinds,
  maxMoves: c.maxMoves,
  injectorsAtOnce: c.injectorsAtOnce,
  spanLeast: c.injectorSpanMin,
  spanMost: c.injectorSpanMax,
  runPoints: c.runPoints,
  injectorPoints: c.injectorPoints,
  flameoutPoints: -c.flameoutPenalty,
  chainPercent: c.chainMultipliers.map((m) => m * 100),
});
const CONFIGS: Record<string, EnginesConfig> = {
  "as shipped": DEFAULT_ENGINES_CONFIG,
  // Two kinds on a narrow core: runs and chains come often, and the core fills and flames out.
  "two kinds on a narrow core": { ...DEFAULT_ENGINES_CONFIG, width: 6, height: 12, pieceKinds: 2, injectorsAtOnce: 2, injectorSpanMin: 1, injectorSpanMax: 3, flameoutPenalty: 25, chainMultipliers: [1, 2, 5] },
  "crowded with injectors": { ...DEFAULT_ENGINES_CONFIG, width: 8, height: 14, injectorsAtOnce: 5, injectorPoints: 9, runPoints: 3, chainMultipliers: [1, 4] },
};

/** The shipped core as the new board holds it: row by row from the top, a pellet's kind counted from 1. */
const shippedCore = (s: EnginesState): (number | null)[][] =>
  Array.from({ length: s.config.height }, (_, y) => Array.from({ length: s.config.width }, (_, x) => s.cells[(s.config.height - 1 - y) * s.config.width + x]?.kind ?? null).map((k) => (k === null ? null : k + 1)));
/** Each injector cell: what it wants, counted from 1, or 0 for a blank. */
const shippedInjectors = (s: EnginesState): (number | null)[][] => {
  const out: (number | null)[][] = Array.from({ length: s.config.height }, () => Array.from({ length: s.config.width }, () => null));
  for (const p of s.injectors) for (const c of p.cells) out[s.config.height - 1 - c.row]![c.col] = c.want === null ? 0 : c.want + 1;
  return out;
};

describe("Engines on the new engine, beside the engine the game ships", () => {
  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`holds the same core, injectors, pairs, score and streak after every pair: ${name}`, () => {
      const seen = { pairs: 0, runs: 0, fired: 0, deepest: 0, flameouts: 0, together: 0 };
      for (let seed = 1; seed <= SEEDS; seed++) {
        let shipped = createEnginesGame(`seed-${seed}`, config);
        let round: Round<PlaceMove> = start(engines, { seed, settings: settingsOf(config), streams: { core: seedFromString(`sailing:seed-${seed}`) } });
        let picks = seedFromString(`picks-${seed}`);
        const pick = (n: number): number => {
          const r = nextInt(picks, n);
          picks = r.state;
          return r.value;
        };
        const level = (where: string): void => {
          const now = read(round);
          const pairs = (now.state as { pairs: { hand: Pair; next: Pair } }).pairs;
          expect(pairs.hand, where).toEqual([shipped.current.a, shipped.current.b]);
          expect(pairs.next, where).toEqual([shipped.next.a, shipped.next.b]);
          expect(now.board.map((r) => r.map((p) => p?.kind ?? null)), where).toEqual(shippedCore(shipped));
          expect(now.ground.map((r) => r.map((g) => (g === null ? null : g.terrain === "blank" ? 0 : Number(g.state!.slice(5))))), where).toEqual(shippedInjectors(shipped));
          expect(now.score, where).toBe(shipped.score);
          expect(now.streak, where).toBe(shipped.combo);
        };
        level(`seed ${seed}, the deal`);
        for (let m = 0; m < PAIRS; m++) {
          // The shipped engine's resting places are the new one's, every one of them.
          const shippedRests = enginesRestingPlacements(shipped).map((r) => ({ x: r.col, y: config.height - 1 - r.row, rot: r.rot }));
          const own = rests(view(round).board).map((r) => ({ ...r.at, rot: r.rot }));
          const order = (a: { x: number; y: number; rot: number }, b: { x: number; y: number; rot: number }): number => a.rot - b.rot || a.y - b.y || a.x - b.x;
          expect(own.sort(order), `seed ${seed}, pair ${m + 1}: where it can rest`).toEqual(shippedRests.sort(order));
          // Mostly a rest that clears something or fills a target, else any rest at all.
          const scoring = shippedRests.filter((r) => reduceEngines(shipped, { type: "place", col: r.x, row: config.height - 1 - r.y, rot: r.rot as 0 }).lastMove!.points > 0);
          const chosen = scoring.length > 0 && pick(3) > 0 ? scoring[pick(scoring.length)]! : shippedRests[pick(shippedRests.length)]!;
          shipped = reduceEngines(shipped, { type: "place", col: chosen.x, row: config.height - 1 - chosen.y, rot: chosen.rot as 0 });
          round = play(round, { move: "place", at: { x: chosen.x, y: chosen.y }, rot: chosen.rot });
          const where = `seed ${seed}, pair ${m + 1}`;
          expect(round.last.refused, where).toBeNull();
          const report = shipped.lastMove!;
          // Step by step: what each step paid, then what the move banked.
          const steps = new Map<number, number>();
          for (const e of round.last.events) if (e.step !== undefined) steps.set(e.step, (steps.get(e.step) ?? 0) + e.points!);
          expect([...steps.values()], where).toEqual(report.rounds.map((r) => r.points));
          level(where);
          seen.pairs++;
          seen.deepest = Math.max(seen.deepest, report.rounds.length);
          if (report.wipe) seen.flameouts++;
          for (const r of report.rounds) {
            seen.runs += r.groups.filter((g) => g.cause === "run").length;
            seen.fired += r.groups.filter((g) => g.cause === "injector").length;
            if (r.groups.length > 1) seen.together++;
          }
        }
      }
      // The comparison means something only if the rounds reached every rule.
      expect(seen.runs, "runs").toBeGreaterThan(5);
      expect(seen.fired, "injectors fired").toBeGreaterThan(5);
      expect(seen.deepest, "the deepest chain").toBeGreaterThan(1);
      // Two kinds on a narrow core is where two clear in one step and the core flames out.
      if (name === "two kinds on a narrow core") expect(seen.together, "steps that cleared two at once").toBeGreaterThan(0), expect(seen.flameouts, "flameouts").toBeGreaterThan(0);
    }, 180_000);
  }
});

describe("Engines as a puzzle of its own", () => {
  it("deals, plays and replays from its seed, settings and log", () => {
    for (let seed = 1; seed <= 4; seed++) {
      let round = start(engines, { seed, settings: { maxMoves: 30 } });
      for (let m = 0; !read(round).ended; m++) round = play(round, hint(round) ?? rests(view(round).board)[0]!, { at: m * 1000 });
      expect(read(round).ended).toBe("moves");
      expect(replay(engines, String(seed), { maxMoves: 30 }, round.log).state).toEqual(round.state);
    }
  });

  it("refuses a rest the pair cannot reach", () => {
    const round = start(engines, { seed: 1 });
    // Floating in the middle of the core: nothing holds it there.
    expect(play(round, { move: "place", at: { x: 5, y: 3 }, rot: 0 }).last.refused).toBe("reason.out_of_reach");
  });

  it("is all there to read: its scoring declared, each hook explained", () => {
    const doc = JSON.parse(expand(engines)) as { payouts: { id: string }[]; multipliers: { id: string }[]; streak: unknown };
    expect(doc.payouts.map((p) => p.id)).toEqual(["run", "fire", "flameout"]);
    expect(doc.multipliers.map((m) => m.id)).toEqual(["chain"]);
    expect(doc.streak).toEqual({ builds: { event: "run or fire" }, grace: 0, breaksOn: ["flameout"] });
    expect(explain(engines)).toMatchInlineSnapshot(`
      "onStart    pairs, then injectors   [every part, in the order listed]
      canMove    pairs (place)
      onMove     pairs (place)
      onCascade  chain
      onMoveEnd  chain, then pairs, then flameout   [every part, in order]
      listMoves  pairs"
    `);
  });
});
