// Reactor, played beside the engine the studio deals. Both are dealt from the same luck, and are held to the same
// core, ports, score and run after every swipe.
import { createReactorGame, DEFAULT_REACTOR_CONFIG, reactorHint, reactorLegalDirs, reduceReactor, type ReactorConfig, type ReactorState } from "@openseas/engine";
import { describe, expect, it } from "vitest";
import reactor, { type Core, type SwipeMove } from "../examples/reactor.puzzle.js";
import { expand, explain, nextInt, play, read, replay, seedFromString, start, view, type Round, type Setting } from "../src/index.js";

const SEEDS = Number(process.env.SEEDS ?? 6);
const MOVES = Number(process.env.MOVES ?? 300);
/** Hands the event loop back for a moment. */
const breathe = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

const settingsOf = (c: ReactorConfig): Record<string, Setting> => ({
  size: c.size,
  hotGrade: c.hotGrade,
  ports: c.ports,
  criticalHot: c.criticalHot,
  startRods: c.startRods,
  twoPermille: c.twoPermille,
  pipelineSwipes: c.pipelineSwipes,
  fusePoints: c.fusePoints,
  dischargePoints: c.dischargePoints,
  pipelinePercent: c.pipelinePercent,
  salvoPercent: c.salvoPercent,
  scramPoints: -c.scramPenalty,
  maxMoves: c.maxMoves,
});
const CONFIGS: Record<string, ReactorConfig> = {
  "as shipped": DEFAULT_REACTOR_CONFIG,
  // A low hot grade and many ports: rods run hot early, leave in salvos, and the run carries on.
  "hot early, many ports": { ...DEFAULT_REACTOR_CONFIG, hotGrade: 3, fusePoints: [3, 7], ports: 5, criticalHot: 5, twoPermille: 450, salvoPercent: [100, 175, 333], pipelinePercent: [100, 133, 166], pipelineSwipes: 4, dischargePoints: 77 },
  "a big core": { ...DEFAULT_REACTOR_CONFIG, size: 6, hotGrade: 5, fusePoints: [1, 3, 9, 27], ports: 3, criticalHot: 3, startRods: 5, scramPenalty: 90 },
};

const shippedCore = (s: ReactorState): (number | null)[][] => Array.from({ length: s.config.size }, (_, y) => Array.from({ length: s.config.size }, (_, x) => s.cells[y * s.config.size + x]?.grade ?? null));

describe("Reactor on the new engine, beside the engine the studio deals", () => {
  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`holds the same core, ports, score and run after every swipe: ${name}`, async () => {
      const seen = { discharges: 0, salvos: 0, scrams: 0, critical: 0, lapses: 0, run: 0 };
      for (let seed = 1; seed <= SEEDS; seed++) {
        await breathe();
        let shipped = createReactorGame(`seed-${seed}`, config);
        let round: Round<SwipeMove> = start(reactor, { seed, settings: settingsOf(config), streams: { core: seedFromString(`reactor:seed-${seed}`) } });
        let picks = seedFromString(`picks-${seed}`);
        const pick = (n: number): number => {
          const r = nextInt(picks, n);
          picks = r.state;
          return r.value;
        };
        const level = (where: string): void => {
          const now = read(round);
          const core = (now.state as { core: Core }).core;
          expect(now.board.map((r) => r.map((p) => p?.kind ?? null)), where).toEqual(shippedCore(shipped));
          expect(core.ports, where).toEqual(shipped.ports);
          expect(core.next, where).toBe(shipped.next);
          expect(now.streak, where).toBe(shipped.combo);
          // The shipped engine rounds each discharge, then the salvo. The loop rounds once a swipe, so it is never behind.
          expect(now.score - shipped.score, where).toBeGreaterThanOrEqual(0);
          expect(now.score - shipped.score, where).toBeLessThanOrEqual(seen.discharges);
          expect(now.stats, where).toMatchObject({ discharges: shipped.discharges, salvos: shipped.salvos, fusions: shipped.fusions, scrams: shipped.scrams });
        };
        level(`seed ${seed}, the deal`);
        for (let m = 0; m < MOVES && !shipped.finished; m++) {
          // Mostly a swipe that discharges when one does, else any swipe that moves anything.
          const dirs = reactorLegalDirs(shipped);
          const best = reactorHint(shipped);
          const dir = best !== null && pick(4) > 0 ? best : dirs[pick(dirs.length)]!;
          shipped = reduceReactor(shipped, { type: "swipe", dir });
          round = play(round, { move: "swipe", dir });
          const where = `seed ${seed}, swipe ${m + 1}`;
          expect(round.last.refused, where).toBeNull();
          const r = shipped.lastMove!;
          seen.discharges += r.discharges.length;
          if (r.discharges.length > 1) seen.salvos++;
          if (r.scram) seen.scrams++, r.scram.cause === "critical" && seen.critical++;
          if (r.lapsed) seen.lapses++;
          seen.run = Math.max(seen.run, shipped.combo);
          level(where);
        }
      }
      // The comparison means something only if the rounds reached every rule.
      expect(seen.discharges, "discharges").toBeGreaterThan(3);
      expect(seen.scrams, "scrams").toBeGreaterThan(0);
      expect(seen.run, "discharges in a run").toBeGreaterThan(1);
      if (name === "hot early, many ports") expect(seen.salvos, "salvos").toBeGreaterThan(0), expect(seen.lapses, "runs that lapsed").toBeGreaterThan(0), expect(seen.critical, "critical scrams").toBeGreaterThan(0);
    }, 180_000);
  }
});

describe("Reactor as a puzzle of its own", () => {
  it("deals, plays and replays from its seed, settings and log", () => {
    for (let seed = 1; seed <= 3; seed++) {
      let round = start(reactor, { seed });
      for (let m = 0; m < 80; m++) {
        const moves = reactor.rules.listMoves!(view(round) as never) as SwipeMove[];
        round = play(round, moves[m % moves.length]!);
        expect(round.last.refused).toBeNull();
      }
      expect(replay(reactor, String(seed), {}, round.log).state).toEqual(round.state);
    }
  });

  it("refuses a swipe that moves nothing", () => {
    const round = start(reactor, { seed: 1 });
    const still = [0, 1, 2, 3].find((dir) => !(reactor.rules.listMoves!(view(round) as never) as SwipeMove[]).some((m) => m.dir === dir));
    if (still !== undefined) expect(play(round, { move: "swipe", dir: still }).last.refused).toBe("reason.nothing_moves");
    expect(play(round, { move: "swipe", dir: 4 }).last.refused).toBe("reason.no_way");
  });

  it("is all there to read: its scoring declared, each hook explained", () => {
    const doc = JSON.parse(expand(reactor)) as { payouts: { id: string }[]; multipliers: { id: string; by: unknown }[]; streak: unknown };
    expect(doc.payouts.map((p) => p.id)).toEqual(["fuse", "discharge", "scram"]);
    expect(doc.multipliers.map((m) => m.by)).toEqual([{ table: "pipelinePercent", index: "streak" }, { table: "salvoPercent", index: "field", field: "out" }]);
    expect(doc.streak).toEqual({ builds: { event: "discharge" }, counts: "events", grace: 0, breaksOn: ["lapse", "scram"] });
    expect(explain(reactor)).toMatchInlineSnapshot(`
      "onStart    core
      canMove    core (swipe)
      onMove     core (swipe)
      listMoves  core
      pointsFor  core"
    `);
  });
});
