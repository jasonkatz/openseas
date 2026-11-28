// Freefall, played beside the engine the studio deals. Both are dealt from the same luck, the rival picks from it in
// both, and the two are held to the same shaft, legs, totals and score after every drop.
import { createFreefallGame, DEFAULT_FREEFALL_CONFIG, freefallEntryLanes, freefallHint, freefallViewString, reduceFreefall, type FreefallConfig, type FreefallState } from "@openseas/engine";
import { describe, expect, it } from "vitest";
import freefall, { rowSpan, type DropMove, type Shaft } from "../examples/freefall.puzzle.js";
import { expand, explain, listMoves, nextInt, play, read, replay, seedFromString, start, type Round, type Setting } from "../src/index.js";

const SEEDS = Number(process.env.SEEDS ?? 20);
/** Hands the event loop back for a moment. */
const breathe = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

const settingsOf = (c: FreefallConfig): Record<string, Setting> => ({
  width: c.width,
  rows: c.rows,
  maxMoves: c.maxMoves,
  entry: c.entry,
  gapPermille: c.gapPermille,
  quotas: c.quotas,
  berths1: c.bays.first,
  berths2: c.bays.second,
  berths3: c.bays.third,
  berths4: c.bays.fourth,
  berths5: c.bays.fifth,
  squareClusters: c.squareClusters,
  rival: c.rival,
  rivalSkill: c.rivalSkill,
});
const CONFIGS: Record<string, FreefallConfig> = {
  "as shipped": DEFAULT_FREEFALL_CONFIG,
  // Alone, clusters counted plainly, a full shaft: every leg ends the moment its quota is reached.
  "alone, plain clusters": { ...DEFAULT_FREEFALL_CONFIG, rival: false, squareClusters: false, gapPermille: 0 },
  // A wide, deep shaft and a sharp rival: the rival leads, and the score holds at nothing.
  "wide, deep, a sharp rival": { ...DEFAULT_FREEFALL_CONFIG, width: 12, entry: 4, rows: 10, gapPermille: 200, rivalSkill: 100, quotas: [30, 60, 60, 90, 120], bays: { first: [1, 1, 2, 3, 5, 8], second: [1, 2, 3, 5, 8, 13], third: [2, 2, 2, 2, 2, 2], fourth: [0, 1, 4, 9, 16, 25], fifth: [5, 4, 3, 2, 1, 0] } },
};

/** The shaft as the engine writes it, from the board. */
const viewOf = (c: FreefallConfig, board: ({ piece: string; state?: unknown } | null)[][]): string =>
  board
    .map((r, row) => {
      const [lo, hi] = rowSpan(c.width, c.entry, c.rows, row);
      return r.map((p, l) => (l < lo || l > hi ? " " : !p ? "." : p.piece === "arm" ? "a" : p.state === 1 ? "P" : "C")).join("");
    })
    .join("|");

describe("Freefall on the new engine, beside the engine the studio deals", () => {
  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`holds the same shaft, legs, totals and score, drop for drop: ${name}`, async () => {
      const seen = { clusters: 0, tossed: 0, legs: 0, closings: 0, rounds: 0, behind: 0, won: 0 };
      for (let seed = 1; seed <= SEEDS; seed++) {
        await breathe();
        let shipped: FreefallState = createFreefallGame(`seed-${seed}`, config);
        let round: Round<DropMove> = start(freefall, { seed, settings: settingsOf(config), streams: { shaft: seedFromString(`freefall:seed-${seed}`) } });
        let picks = seedFromString(`picks-${seed}`);
        const pick = (n: number): number => {
          const r = nextInt(picks, n);
          picks = r.state;
          return r.value;
        };
        const level = (where: string): void => {
          const now = read(round);
          const s = (now.state as { shaft: Shaft }).shaft;
          expect(viewOf(config, now.board), where).toBe(freefallViewString(config, shipped.rockers));
          expect(s.totals, where).toEqual(shipped.totals);
          expect(Math.min(s.leg, 4), where).toBe(shipped.leg);
          if (!shipped.finished) expect({ legPoints: s.legPoints, closing: s.closing }, where).toEqual({ legPoints: shipped.legPoints, closing: shipped.closing });
          expect(now.score, where).toBe(shipped.score);
          expect(now.stats, where).toMatchObject({ legsWon: shipped.legsWon, rivalDrops: shipped.rivalDrops, bestCombo: shipped.bestCombo, bestCluster: shipped.bestCluster });
        };
        level(`seed ${seed}, the deal`);
        const [lo, hi] = freefallEntryLanes(config);
        while (!shipped.finished) {
          const where = `seed ${seed}, drop ${shipped.moveCount + 1}`;
          // Mostly the drop worth most at once, now and then any entry lane.
          const hint = freefallHint(shipped)!;
          const lane = pick(3) > 0 ? hint : lo + pick(hi - lo + 1);
          shipped = reduceFreefall(shipped, { type: "drop", lane });
          round = play(round, { move: "drop", lane });
          expect(round.last.refused, where).toBeNull();
          for (const d of shipped.lastMove!.drops) {
            if (d.landed.some((l) => l.ids.length > 1)) seen.clusters++;
            if (d.steps.some((s) => s.tossed.length > 0)) seen.tossed++;
            if (d.legEnded) seen.legs++;
          }
          if (shipped.closing !== null) seen.closings++;
          if (shipped.totals[1] > shipped.totals[0]) seen.behind++;
          level(where);
        }
        if (shipped.leg === 4 && shipped.moveCount < config.maxMoves) {
          seen.rounds++;
          expect(listMoves(round), `seed ${seed}, the end`).toEqual([]);
        }
        seen.won += shipped.legsWon;
      }
      // The comparison means something only if the rounds reached every rule.
      expect(seen.clusters, "clusters").toBeGreaterThan(0);
      expect(seen.tossed, "pods tossed").toBeGreaterThan(0);
      expect(seen.rounds, "rounds played through five legs").toBeGreaterThan(SEEDS / 3);
      if (config.rival) expect(seen.closings, "closing drops").toBeGreaterThan(0), expect(seen.behind, "drops behind the rival").toBeGreaterThan(0);
      expect(seen.won, "legs won").toBeGreaterThan(0);
    }, 180_000);
  }
});

describe("Freefall as a puzzle of its own", () => {
  it("deals, plays and replays from its seed, settings and log", () => {
    for (let seed = 1; seed <= 3; seed++) {
      let round = start(freefall, { seed });
      for (let m = 0; m < 40 && listMoves(round).length > 0; m++) round = play(round, { move: "drop", lane: 2 + (m % 4) });
      expect(read(round).stats.rivalDrops).toBeGreaterThan(0);
      expect(replay(freefall, String(seed), {}, round.log).state).toEqual(round.state);
    }
  });

  it("refuses a drop outside the entry lanes", () => {
    const round = start(freefall, { seed: 1 });
    expect(play(round, { move: "drop", lane: 0 }).last.refused).toBe("reason.no_lane");
    expect(play(round, { move: "drop", lane: 6 }).last.refused).toBe("reason.no_lane");
  });

  it("is all there to read: its scoring declared, each hook explained", () => {
    const doc = JSON.parse(expand(freefall)) as { payouts: { id: string; counts?: string }[] };
    expect(doc.payouts.map((p) => [p.id, p.counts])).toEqual([["landing", "worth"]]);
    expect(explain(freefall)).toMatchInlineSnapshot(`
      "onStart    shaft
      canMove    shaft (drop)
      onMove     shaft (drop)
      listMoves  shaft
      pointsFor  shaft"
    `);
  });
});
