// Tractor, played beside the engine the studio deals. Both are dealt from the same luck, and are held to the same
// field and score after every swap.
import { createTractorGame, DEFAULT_TRACTOR_CONFIG, reduceTractor, TRACTOR_CACHE, tractorHint, type TractorConfig, type TractorState } from "@openseas/engine";
import { describe, expect, it } from "vitest";
import tractor, { type Hold, type SwapMove } from "../examples/tractor.puzzle.js";
import { expand, explain, nextInt, play, read, replay, seedFromString, start, view, type Round, type Setting } from "../src/index.js";

const SEEDS = Number(process.env.SEEDS ?? 5);
const MOVES = Number(process.env.MOVES ?? 150);
/** Hands the event loop back for a moment. */
const breathe = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

const settingsOf = (c: TractorConfig): Record<string, Setting> => ({
  width: c.width,
  height: c.height,
  kinds: c.kinds,
  startCaches: c.startCaches,
  cachePermille: c.cachePermille,
  maxCaches: c.maxCaches,
  beaconEvery: c.beaconEvery,
  runPoints: c.runPoints,
  sweepPoints: c.sweepPoints,
  cachePoints: c.cachePoints,
  cascadePercent: c.cascadePercent,
  maxMoves: c.maxMoves,
});
const CONFIGS: Record<string, TractorConfig> = {
  "as shipped": DEFAULT_TRACTOR_CONFIG,
  // Few kinds, many caches and a beacon every other scoring swap: cascades, sweeps and caches hauled together.
  "few kinds, many caches and beacons": { ...DEFAULT_TRACTOR_CONFIG, kinds: 3, startCaches: 3, cachePermille: 150, maxCaches: 4, beaconEvery: 2, cascadePercent: [100, 133, 166, 199], sweepPoints: 7 },
  "a wide, short field": { ...DEFAULT_TRACTOR_CONFIG, width: 9, height: 6, kinds: 6, beaconEvery: 3, runPoints: 3 },
};

const shippedField = (s: TractorState): unknown[][] =>
  Array.from({ length: s.config.height }, (_, y) => Array.from({ length: s.config.width }, (_, x) => {
    const p = s.cells[y * s.config.width + x]!;
    return p.kind === TRACTOR_CACHE ? { piece: "cache" } : p.mark ? { piece: "beacon", kind: p.kind + 1, state: p.mark } : { piece: "loot", kind: p.kind + 1 };
  }));

describe("Tractor on the new engine, beside the engine the studio deals", () => {
  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`holds the same field and score after every swap: ${name}`, async () => {
      const seen = { clears: 0, waves: 0, fired: 0, caches: 0, together: 0, shuffles: 0, apart: 0 };
      for (let seed = 1; seed <= SEEDS; seed++) {
        await breathe();
        let shipped = createTractorGame(`seed-${seed}`, config);
        let round: Round<SwapMove> = start(tractor, { seed, settings: settingsOf(config), streams: { field: seedFromString(`tractor:seed-${seed}`) } });
        let picks = seedFromString(`picks-${seed}`);
        const pick = (n: number): number => {
          const r = nextInt(picks, n);
          picks = r.state;
          return r.value;
        };
        const level = (where: string): void => {
          const now = read(round);
          expect(now.board.map((r) => r.map((p) => ({ piece: p!.piece, ...(p!.kind === undefined ? {} : { kind: p!.kind }), ...(p!.state === undefined ? {} : { state: p!.state }) }))), where).toEqual(shippedField(shipped));
          // The shipped engine rounds each wave. The loop rounds once a swap, so it is never behind.
          expect(now.score - shipped.score, where).toBeGreaterThanOrEqual(0);
          expect(now.score - shipped.score, where).toBeLessThanOrEqual(seen.apart);
          expect((now.state as { hold: Hold }).hold.clears, where).toBe(shipped.clears);
          expect(now.stats, where).toMatchObject({ cleared: shipped.cleared, caches: shipped.cachesHauled, fired: shipped.beaconsFired });
        };
        level(`seed ${seed}, the deal`);
        for (let m = 0; m < MOVES && !shipped.finished; m++) {
          // Mostly the swap worth most at once, now and then any swap at all.
          const best = tractorHint(shipped);
          const legal = tractor.rules.listMoves!(view(round) as never) as SwapMove[];
          const at = best !== null && pick(4) > 0 ? { x: best % config.width, y: Math.floor(best / config.width) } : legal[pick(legal.length)]!.at;
          shipped = reduceTractor(shipped, { type: "swap", cell: at.y * config.width + at.x });
          round = play(round, { move: "swap", at });
          const where = `seed ${seed}, swap ${m + 1}`;
          expect(round.last.refused, where).toBeNull();
          const r = shipped.lastMove!;
          if (r.waves.length > 0) seen.clears++;
          seen.waves = Math.max(seen.waves, r.waves.length);
          seen.apart += r.waves.length;
          seen.fired += r.waves.reduce((a, w) => a + w.fired.length, 0);
          seen.caches += r.caches.length;
          if (r.caches.length > 1) seen.together++;
          if (r.shuffled) seen.shuffles++;
          level(where);
        }
      }
      // The comparison means something only if the rounds reached every rule.
      expect(seen.clears, "scoring swaps").toBeGreaterThan(10);
      expect(seen.waves, "the most waves of one swap").toBeGreaterThan(1);
      expect(seen.fired, "beacons fired").toBeGreaterThan(0);
      expect(seen.caches, "caches hauled").toBeGreaterThan(0);
      if (name === "few kinds, many caches and beacons") expect(seen.together, "caches hauled together").toBeGreaterThan(0);
    }, 180_000);
  }
});

describe("Tractor as a puzzle of its own", () => {
  it("deals, plays and replays from its seed, settings and log", () => {
    for (let seed = 1; seed <= 3; seed++) {
      let round = start(tractor, { seed });
      for (let m = 0; m < 50; m++) {
        const moves = tractor.rules.listMoves!(view(round) as never) as SwapMove[];
        round = play(round, moves[(m * 11) % moves.length]!);
        expect(round.last.refused).toBeNull();
      }
      expect(replay(tractor, String(seed), {}, round.log).state).toEqual(round.state);
    }
  });

  it("refuses a swap on the bottom row", () => {
    expect(play(start(tractor, { seed: 1 }), { move: "swap", at: { x: 0, y: 8 } }).last.refused).toBe("reason.no_below");
  });

  it("is all there to read: its scoring declared, each hook explained", () => {
    const doc = JSON.parse(expand(tractor)) as { payouts: { id: string }[]; multipliers: { by: unknown }[] };
    expect(doc.payouts.map((p) => p.id)).toEqual(["run", "sweep", "haul"]);
    expect(doc.multipliers.map((m) => m.by)).toEqual([{ table: "cascadePercent", index: "step" }]);
    expect(explain(tractor)).toMatchInlineSnapshot(`
      "onStart    hold
      canMove    hold (swap)
      onMove     hold (swap)
      onCascade  hold
      onMoveEnd  hold
      listMoves  hold"
    `);
  });
});
