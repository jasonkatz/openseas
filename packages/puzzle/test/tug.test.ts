// Tug, played beside the engine the studio deals. Both are dealt from the same luck, and are held to the same bay,
// clamp, score and streak after every flick and skip.
import { createTugGame, DEFAULT_TUG_CONFIG, reduceTug, tugSolve as solve, type TugConfig, type TugMove, type TugState } from "@openseas/engine";
import { describe, expect, it } from "vitest";
import tug, { type Bay, type FlickMove, type SkipMove } from "../examples/tug.puzzle.js";
import { expand, explain, nextInt, play, read, replay, seedFromString, start, view, type Round, type Setting } from "../src/index.js";

type Move = FlickMove | SkipMove;
const SEEDS = Number(process.env.SEEDS ?? 6);
const MOVES = Number(process.env.MOVES ?? 200);
/** Hands the event loop back for a moment. */
const breathe = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

const settingsOf = (c: TugConfig): Record<string, Setting> => ({
  width: c.width,
  height: c.height,
  pods: c.pods,
  blocks: c.blocks,
  startPar: c.startPar,
  maxPar: c.maxPar,
  cleanPerStep: c.cleanPerStep,
  slack: c.slack,
  parPoints: c.parPoints,
  cleanPercent: c.cleanPercent,
  slowPercent: c.slowPercent,
  streakPercent: c.streakPercent,
  skipPoints: -c.skipPenalty,
  maxMoves: c.maxMoves,
});
const CONFIGS: Record<string, TugConfig> = {
  "as shipped": DEFAULT_TUG_CONFIG,
  // A small bay, shallow pars and a long streak table: clamps come often, and the streak runs.
  "a small bay with shallow pars": { ...DEFAULT_TUG_CONFIG, width: 5, height: 5, pods: 3, blocks: 2, startPar: 1, maxPar: 3, cleanPerStep: 1, slack: 1, cleanPercent: 150, streakPercent: [100, 133, 166, 199] },
  "a wide bay of five pods": { ...DEFAULT_TUG_CONFIG, width: 9, height: 6, pods: 5, blocks: 7, startPar: 3, maxPar: 3, slack: 0, slowPercent: 30, skipPenalty: 40 },
};

describe("Tug on the new engine, beside the engine the studio deals", () => {
  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`holds the same bay, clamp, score and streak after every flick: ${name}`, async () => {
      const seen = { clean: 0, full: 0, slow: 0, skips: 0, chain: 0, apart: 0 };
      for (let seed = 1; seed <= SEEDS; seed++) {
        await breathe();
        let shipped = createTugGame(`seed-${seed}`, config);
        let round: Round<Move> = start(tug, { seed, settings: settingsOf(config), streams: { bay: seedFromString(`tug:seed-${seed}`) } });
        let picks = seedFromString(`picks-${seed}`);
        const pick = (n: number): number => {
          const r = nextInt(picks, n);
          picks = r.state;
          return r.value;
        };
        const level = (where: string): void => {
          const now = read(round);
          const bay = (now.state as { bay: Bay }).bay;
          expect(bay.pods, where).toEqual(shipped.pods);
          expect(bay.blocks, where).toEqual(shipped.blocks);
          expect(bay.clamp, where).toEqual(shipped.clamp);
          expect(bay.level, where).toBe(shipped.level);
          expect(now.streak, where).toBe(shipped.combo);
          // The shipped engine rounds a clean delivery twice. The loop rounds once, so it is never behind.
          expect(now.score - shipped.score, where).toBeGreaterThanOrEqual(0);
          expect(now.score - shipped.score, where).toBeLessThanOrEqual(seen.apart);
          const board = now.board.map((r) => r.map((p) => p?.kind ?? null));
          const want = Array.from({ length: config.height }, (_, y) => Array.from({ length: config.width }, (_, x) => { const p = shipped.pods.indexOf(y * config.width + x); return p < 0 ? null : p + 1; }));
          expect(board, where).toEqual(want);
          expect(now.stats, where).toMatchObject({ delivered: shipped.delivered, clean: shipped.clean, skipped: shipped.skipped });
        };
        level(`seed ${seed}, the deal`);
        for (let m = 0; m < MOVES && !shipped.finished; m++) {
          // Mostly the shortest way to the clamp, so pods are delivered at par. Now and then any flick, or a skip.
          const way = solve(shipped);
          const kind = pick(10);
          let move: TugMove;
          if (kind === 0) move = { type: "skip" };
          else if (way && kind > 3) move = way[0]!;
          else {
            const legal = view(round) && (tug.rules.listMoves!(view(round) as never) as FlickMove[]);
            const f = legal[pick(legal.length)]!;
            move = { type: "flick", pod: f.pod, dir: f.dir as 0 };
          }
          const before = shipped.score;
          shipped = reduceTug(shipped, move);
          round = play(round, move.type === "skip" ? { move: "skip" } : { move: "flick", pod: move.pod, dir: move.dir });
          const where = `seed ${seed}, move ${m + 1}`;
          expect(round.last.refused, where).toBeNull();
          const r = shipped.lastMove!;
          if (r.delivered) {
            seen[r.delivered.grade]++;
            if (r.delivered.grade === "clean") seen.apart++, (seen.chain = Math.max(seen.chain, r.delivered.streak));
          }
          if (r.skipped) seen.skips++;
          void before;
          level(where);
        }
      }
      // The comparison means something only if the rounds reached every rule.
      expect(seen.clean, "clean deliveries").toBeGreaterThan(3);
      expect(seen.full + seen.slow, "late deliveries").toBeGreaterThan(0);
      expect(seen.skips, "skips").toBeGreaterThan(0);
      expect(seen.chain, "clean in a row").toBeGreaterThan(1);
    }, 180_000);
  }
});

describe("Tug as a puzzle of its own", () => {
  it("deals, plays and replays from its seed, settings and log", () => {
    for (let seed = 1; seed <= 3; seed++) {
      let round = start(tug, { seed });
      for (let m = 0; m < 40; m++) {
        const moves = tug.rules.listMoves!(view(round) as never) as Move[];
        round = play(round, m % 13 === 12 ? { move: "skip" } : moves[m % moves.length]!);
      }
      expect(replay(tug, String(seed), {}, round.log).state).toEqual(round.state);
    }
  });

  it("refuses a pod that cannot move that way", () => {
    let round = start(tug, { seed: 1 });
    const bay = (view(round).state as { bay: Bay }).bay;
    const stuck = [0, 1, 2, 3].find((dir) => !(tug.rules.listMoves!(view(round) as never) as FlickMove[]).some((f) => f.pod === 0 && f.dir === dir));
    if (stuck !== undefined) expect(play(round, { move: "flick", pod: 0, dir: stuck }).last.refused).toBe("reason.no_way");
    expect(play(round, { move: "flick", pod: bay.pods.length, dir: 0 }).last.refused).toBe("reason.no_pod");
    round = play(round, { move: "skip" });
    expect(read(round).score).toBe(0);
  });

  it("is all there to read: its scoring declared, each hook explained", () => {
    const doc = JSON.parse(expand(tug)) as { payouts: { id: string }[]; multipliers: { id: string }[]; streak: unknown };
    expect(doc.payouts.map((p) => p.id)).toEqual(["clean", "late", "skip"]);
    expect(doc.multipliers.map((m) => m.id)).toEqual(["clean", "slow", "streak"]);
    expect(doc.streak).toEqual({ builds: { event: "clean" }, counts: "events", grace: 0, breaksOn: ["late", "skip"] });
    expect(explain(tug)).toMatchInlineSnapshot(`
      "onStart    bay
      canMove    bay (flick)
      onMove     bay (flick, skip)
      listMoves  bay
      pointsFor  bay"
    `);
  });
});
