// Cutting, played beside the engine the studio deals. Both are dealt from the same luck, and are held to the same
// slab, pieces, score and streak after every cut.
import { createCuttingGame, cuttingBestCut, DEFAULT_CUTTING_CONFIG, reduceCutting, type CuttingConfig, type CuttingMove, type CuttingState } from "@openseas/engine";
import { describe, expect, it } from "vitest";
import cutting, { type CutMove, type DoneMove, type Slab } from "../examples/cutting.puzzle.js";
import { expand, explain, nextInt, play, read, replay, seedFromString, start, view, type Round, type Setting } from "../src/index.js";

type Move = CutMove | DoneMove;
const SEEDS = Number(process.env.SEEDS ?? 5);
const MOVES = Number(process.env.MOVES ?? 120);
/** Hands the event loop back for a moment. */
const breathe = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

const settingsOf = (c: CuttingConfig): Record<string, Setting> => ({
  width: c.width,
  height: c.height,
  ores: c.ores,
  partsLeast: c.partsStart,
  partsMost: c.partsMax,
  flawsLeast: c.flawsStart,
  flawsMost: c.flawsMax,
  growEvery: c.growEvery,
  maxBlockPercent: c.maxBlockPercent,
  budgetPercent: c.budgetPercent,
  minCuts: c.minCuts,
  maxCuts: c.maxCuts,
  cleanPercent: c.cleanPercent,
  cellPoints: c.cellPoints,
  cleanPoints: c.cleanBonus,
  flawlessPoints: c.flawlessBonus,
  streakPercent: c.streakPercent,
  maxMoves: c.maxMoves,
});
const CONFIGS: Record<string, CuttingConfig> = {
  "as shipped": DEFAULT_CUTTING_CONFIG,
  // A small slab of two ores and a generous torch: slabs come quickly, often flawless, and the streak runs.
  "a small slab, a generous torch": { ...DEFAULT_CUTTING_CONFIG, width: 4, height: 5, ores: 2, partsStart: 3, partsMax: 5, flawsStart: 0, flawsMax: 1, growEvery: 1, maxBlockPercent: 60, budgetPercent: 100, minCuts: 2, maxCuts: 5, cellPoints: 3, streakPercent: [100, 133, 166] },
  "a wide slab, many flaws": { ...DEFAULT_CUTTING_CONFIG, width: 7, height: 5, ores: 5, partsStart: 6, partsMax: 9, flawsStart: 2, flawsMax: 4, budgetPercent: 70, cleanPercent: 65 },
};

const shippedBoard = (s: CuttingState): (number | null)[][] =>
  Array.from({ length: s.config.height }, (_, y) => Array.from({ length: s.config.width }, (_, x) => (s.pieces.some((p) => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h) ? s.ores[y * s.config.width + x]! + 1 : null)));

describe("Cutting on the new engine, beside the engine the studio deals", () => {
  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`holds the same slab, pieces, score and streak after every cut: ${name}`, async () => {
      const seen = { slabs: 0, flawless: 0, clean: 0, rough: 0, given: 0, streak: 0 };
      for (let seed = 1; seed <= SEEDS; seed++) {
        await breathe();
        let shipped = createCuttingGame(`seed-${seed}`, config);
        let round: Round<Move> = start(cutting, { seed, settings: settingsOf(config), streams: { slab: seedFromString(`cutting:seed-${seed}`) } });
        let picks = seedFromString(`picks-${seed}`);
        const pick = (n: number): number => {
          const r = nextInt(picks, n);
          picks = r.state;
          return r.value;
        };
        const level = (where: string): void => {
          const now = read(round);
          const s = (now.state as { slab: Slab }).slab;
          expect(s.ores, where).toEqual(shipped.ores);
          expect(s.pieces, where).toEqual(shipped.pieces);
          expect([s.cutsLeft, s.got, s.best, s.slab], where).toEqual([shipped.cutsLeft, shipped.slabGot, shipped.slabBest, shipped.slab]);
          expect(now.board.map((r) => r.map((p) => p?.kind ?? null)), where).toEqual(shippedBoard(shipped));
          expect(now.score, where).toBe(shipped.score);
          expect(now.streak, where).toBe(shipped.combo);
          expect(now.stats.slabs ?? 0, where).toBe(shipped.slabsDone);
        };
        level(`seed ${seed}, the deal`);
        for (let m = 0; m < MOVES && !shipped.finished; m++) {
          // Mostly the first cut of a best plan, now and then any cut, and now and then the slab given up.
          const best = cuttingBestCut(shipped);
          const kind = pick(12);
          let move: CuttingMove;
          if (kind === 0) move = { type: "done" };
          else if (best && kind > 4) move = { type: "cut", ...best };
          else {
            const legal = (cutting.rules.listMoves!(view(round) as never) as Move[]).filter((x): x is CutMove => x.move === "cut");
            const c = legal[pick(legal.length)];
            move = c ? { type: "cut", piece: c.piece, vertical: c.vertical, at: c.at } : { type: "done" };
          }
          shipped = reduceCutting(shipped, move);
          round = play(round, move.type === "done" ? { move: "done" } : { move: "cut", piece: (move as { piece: number }).piece, vertical: (move as { vertical: boolean }).vertical, at: (move as { at: number }).at });
          const where = `seed ${seed}, move ${m + 1}`;
          expect(round.last.refused, where).toBeNull();
          const slab = shipped.lastMove!.slab;
          if (slab) (seen.slabs++, seen[slab.grade]++), slab.reason === "done" && seen.given++;
          seen.streak = Math.max(seen.streak, shipped.combo);
          level(where);
        }
      }
      // The comparison means something only if the rounds reached every rule.
      expect(seen.slabs, "slabs").toBeGreaterThan(5);
      expect(seen.flawless, "flawless slabs").toBeGreaterThan(0);
      expect(seen.rough, "rough slabs").toBeGreaterThan(0);
      expect(seen.given, "slabs given up").toBeGreaterThan(0);
      expect(seen.streak, "good slabs in a row").toBeGreaterThan(1);
      if (name !== "a small slab, a generous torch") expect(seen.clean, "clean slabs").toBeGreaterThan(0);
    }, 180_000);
  }
});

describe("Cutting as a puzzle of its own", () => {
  it("deals, plays and replays from its seed, settings and log", () => {
    for (let seed = 1; seed <= 3; seed++) {
      let round = start(cutting, { seed });
      for (let m = 0; m < 40; m++) {
        const moves = cutting.rules.listMoves!(view(round) as never) as Move[];
        round = play(round, moves[(m * 5) % moves.length]!);
        expect(round.last.refused).toBeNull();
      }
      expect(read(round).stats.slabs).toBeGreaterThan(2);
      expect(replay(cutting, String(seed), {}, round.log).state).toEqual(round.state);
    }
  });

  it("refuses a line outside the piece, and a piece not on the table", () => {
    const round = start(cutting, { seed: 1 });
    expect(play(round, { move: "cut", piece: 1, vertical: true, at: 0 }).last.refused).toBe("reason.not_inside");
    expect(play(round, { move: "cut", piece: 9, vertical: true, at: 2 }).last.refused).toBe("reason.no_piece");
  });

  it("is all there to read: its scoring declared, each hook explained", () => {
    const doc = JSON.parse(expand(cutting)) as { payouts: { id: string; growth: string }[]; streak: unknown };
    expect(doc.payouts.map((p) => [p.id, p.growth])).toEqual([["bank", "superlinear"], ["flawless", "flat"], ["clean", "flat"]]);
    expect(doc.streak).toEqual({ builds: { event: "flawless or clean" }, counts: "events", grace: 0, breaksOn: ["rough"] });
    expect(explain(cutting)).toMatchInlineSnapshot(`
      "onStart    slab
      canMove    slab (cut)
      onMove     slab (cut, done)
      listMoves  slab"
    `);
  });
});
