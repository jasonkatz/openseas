// Deflectors, played beside the engine the studio deals. Both are dealt from the same luck, and are held to the same
// grid, targets, queue and counts after every stretch of ticks and every move, and to the same score within what the
// two round apart: the engine floors each beam and then the shot, the loop each beam once.
import { advanceDeflectors, createDeflectorsGame, DEFAULT_DEFLECTORS_CONFIG, deflectorsHint, reduceDeflectors, type DeflectorsConfig, type DeflectorsMove, type DeflectorsState } from "@openseas/engine";
import { describe, expect, it } from "vitest";
import deflectors, { type Range } from "../examples/deflectors.puzzle.js";
import { advance, expand, explain, listMoves, nextInt, play, read, replay, seedFromString, start, type Round, type Setting } from "../src/index.js";

const TICK = 100;
const SEEDS = Number(process.env.SEEDS ?? 10);
/** Hands the event loop back for a moment. */
const breathe = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

const settingsOf = (c: DeflectorsConfig): Record<string, Setting> => ({
  size: c.size,
  roundSeconds: (c.maxTick * c.tickMs) / 1000,
  maxMoves: c.maxMoves,
  emitters: c.emitters,
  targets: c.targets,
  mirrors: c.mirrors,
  lenses: c.lenses,
  recipeWeights: c.recipeWeights,
  lensPercent: [1, 2, 3].map((k) => 100 + k * c.lensPercent),
  bouncePoints: c.bouncePoints,
  legCap: c.bounceCap + 1,
  litPercent: c.litPercent,
  spend: c.spend,
  pieces: c.pieces,
  queueSize: c.queueSize,
  lensChance: c.lensChance,
  splitterChance: c.splitterChance,
  fireTicks: c.fireTicks,
});
const CONFIGS: Record<string, DeflectorsConfig> = {
  "as shipped": DEFAULT_DEFLECTORS_CONFIG,
  // Many splitters, many emitters, a short cap and no spending: shots that light several targets, long beams capped.
  "splitters, kept grid, a short cap": { ...DEFAULT_DEFLECTORS_CONFIG, size: 7, emitters: 5, targets: 8, mirrors: 12, splitterChance: 30, spend: false, bounceCap: 2, bouncePoints: 7, lensPercent: 35, litPercent: [100, 150, 175, 300] },
  // No recipes, few pieces, a quick trigger: the supply runs out, and plain targets light often.
  "plain targets, a short supply": { ...DEFAULT_DEFLECTORS_CONFIG, size: 4, emitters: 2, targets: 4, mirrors: 3, lenses: 0, recipeWeights: [1], lensChance: 0, pieces: 12, queueSize: 2, fireTicks: 0 },
};

const KIND = (c: number): { piece: string; state?: number } | null => (c === 0 ? null : c <= 2 ? { piece: "mirror", state: c - 1 } : c === 6 ? { piece: "splitter" } : { piece: "lens", state: c - 3 });
const shippedGrid = (s: DeflectorsState) => Array.from({ length: s.config.size }, (_, y) => Array.from({ length: s.config.size }, (_, x) => KIND(s.mirrors[y * s.config.size + x]!)));

describe("Deflectors on the new engine, beside the engine the studio deals", () => {
  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`holds the same grid, targets, queue and score, tick for tick: ${name}`, async () => {
      const seen = { shots: 0, lit: 0, several: 0, lenses: 0, capped: 0, split: 0, dry: 0, apart: 0 };
      for (let seed = 1; seed <= SEEDS; seed++) {
        await breathe();
        let shipped = createDeflectorsGame(`seed-${seed}`, config);
        let round: Round = start(deflectors, { seed, settings: settingsOf(config), streams: { range: seedFromString(`deflectors:seed-${seed}`) } });
        let picks = seedFromString(`picks-${seed}`);
        const pick = (n: number): number => {
          const r = nextInt(picks, n);
          picks = r.state;
          return r.value;
        };
        // How far the score may stand from the engine's: a point either way for each lighting beam so far.
        let slack = 0;
        const level = (where: string): void => {
          const now = read(round);
          const range = (now.state as { range: Range }).range;
          expect(now.board.map((r) => r.map((p) => (p ? (p.piece === "splitter" ? { piece: p.piece } : { piece: p.piece, state: p.state }) : null))), where).toEqual(shippedGrid(shipped));
          expect(range.targets, where).toEqual(shipped.targets);
          expect(range.queue, where).toEqual(shipped.queue);
          expect(range.left, where).toBe(shipped.left);
          expect(Math.abs(now.score - shipped.score), where).toBeLessThanOrEqual(slack);
          expect(now.stats, where).toMatchObject({ placed: shipped.placed, binned: shipped.binned, shots: shipped.shots, lit: shipped.lit, spent: shipped.spent, bestLit: shipped.bestLit, longest: shipped.longest });
          if (now.score !== shipped.score) seen.apart++;
        };
        level(`seed ${seed}, the deal`);
        let tick = 0;
        const last = config.maxTick - 20;
        while (tick < last && !shipped.finished) {
          tick = Math.min(last, tick + pick(pick(5) === 0 ? 20 : 4));
          const where = `seed ${seed}, tick ${tick}`;
          const now = advanceDeflectors(shipped, tick);
          // The hint's piece, turned as it says; a shot when one is ready and worth firing; else any piece or a bin.
          const kind = pick(12);
          const hint = deflectorsHint(now);
          let move: DeflectorsMove | null = null;
          if (now.queue.length === 0) seen.dry++;
          if (tick >= now.fireTick && (kind < 3 || (kind < 6 && !hint) || now.queue.length === 0)) move = { type: "fire", tick };
          else if (now.queue.length > 0 && hint && kind < 10) move = hint.turn ? { type: "turn", tick } : { type: "place", cell: hint.cell, tick };
          else if (now.queue.length > 0) move = kind === 11 ? { type: "bin", tick } : { type: "place", cell: pick(config.size * config.size), tick };
          if (!move) {
            shipped = now;
            round = advance(round, { at: tick * TICK });
            level(where);
            continue;
          }
          shipped = reduceDeflectors(now, move);
          round = play(round, move.type === "place" ? { move: "place", at: { x: move.cell % config.size, y: Math.floor(move.cell / config.size) } } : { move: move.type }, { at: tick * TICK });
          expect(round.last.refused, where).toBeNull();
          for (const e of shipped.lastMove!.events) {
            if (e.type !== "fire") continue;
            seen.shots++;
            seen.lit += e.outcome.lit;
            slack += e.outcome.lit;
            if (e.outcome.lit > 1) seen.several++;
            for (const b of e.outcome.shots) {
              if (b.target < 0) continue;
              if (b.lenses > 0) seen.lenses++;
              if (b.bounces > config.bounceCap) seen.capped++;
            }
            if (e.outcome.shots.length > config.emitters) seen.split++;
          }
          level(where);
          if (shipped.finished) break;
        }
      }
      // The comparison means something only if the rounds reached every rule.
      expect(seen.lit, "targets lit").toBeGreaterThan(5);
      expect(seen.several, "shots that lit several").toBeGreaterThan(0);
      if (name === "as shipped") expect(seen.lenses, "recipes of lenses").toBeGreaterThan(0), expect(seen.split, "split beams").toBeGreaterThan(0);
      if (name === "splitters, kept grid, a short cap") expect(seen.capped, "beams past the cap").toBeGreaterThan(0);
      if (name === "plain targets, a short supply") expect(seen.dry, "the supply used up").toBeGreaterThan(0);
    }, 180_000);
  }
});

describe("Deflectors as a puzzle of its own", () => {
  it("deals, plays and replays from its seed, settings and log", () => {
    for (let seed = 1; seed <= 3; seed++) {
      let round = start(deflectors, { seed });
      for (let m = 0; m < 60; m++) {
        const moves = listMoves(round);
        round = play(round, m % 6 === 5 && moves.some((x) => x.move === "fire") ? { move: "fire" } : moves[(m * 11) % moves.length]!, { at: m * 400 });
      }
      expect(read(round).stats.shots).toBeGreaterThan(0);
      expect(replay(deflectors, String(seed), {}, round.log).state).toEqual(round.state);
    }
  });

  it("refuses a shot before the emitters are ready, and a turn of no mirror", () => {
    let round = start(deflectors, { seed: 1 });
    round = play(round, { move: "fire" }, { at: 0 });
    expect(play(round, { move: "fire" }, { at: 300 }).last.refused).toBe("reason.not_ready");
    round = start(deflectors, { seed: 1, settings: { lensChance: 0, splitterChance: 100 } });
    expect(play(round, { move: "turn" }).last.refused).toBe("reason.no_mirror");
  });

  it("is all there to read: its scoring declared, each hook explained", () => {
    const doc = JSON.parse(expand(deflectors)) as { payouts: { id: string; growth: string }[]; multipliers: { id: string; by: unknown }[] };
    expect(doc.payouts.map((p) => [p.id, p.growth])).toEqual([["beam", "superlinear"]]);
    expect(doc.multipliers.map((m) => m.by)).toEqual([{ table: "lensPercent", index: "field", field: "lenses" }, { table: "litPercent", index: "field", field: "lit" }]);
    expect(explain(deflectors)).toMatchInlineSnapshot(`
      "onStart    range
      canMove    range (place, bin, turn, fire)
      onMove     range (place, bin, turn, fire)
      onTick     range
      listMoves  range"
    `);
  });
});
