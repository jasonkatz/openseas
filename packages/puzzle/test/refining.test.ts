// Refining, played beside the engine the studio deals. Both are dealt from the same luck, and are held to the same
// tower, run, score and counts after every stretch of ticks, every swap and every early draw.
import { advanceRefining, createRefiningGame, DEFAULT_REFINING_CONFIG, reduceRefining, refiningHint, refiningLinks, type RefiningConfig, type RefiningMove, type RefiningState } from "@openseas/engine";
import { describe, expect, it } from "vitest";
import refining, { type SwapMove, type DrawMove } from "../examples/refining.puzzle.js";
import { advance, expand, explain, nextInt, play, read, replay, seedFromString, start, type Round, type Setting } from "../src/index.js";

const TICK = 100;
const SEEDS = Number(process.env.SEEDS ?? 6);
const KINDS = ["vapour", "oil", "tar", "smoke", "catalyst"];
/** Hands the event loop back for a moment. */
const breathe = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

const settingsOf = (c: RefiningConfig): Record<string, Setting> => ({
  width: c.width,
  height: c.height,
  vapourPermille: c.vapourPermille,
  oilPermille: c.oilPermille,
  catalystPermille: c.catalystPermille,
  pulseTicks: c.pulseTicks,
  smokeEvery: c.smokeEvery,
  runCap: c.runCap,
  clearPoints: c.clearPoints,
  smoothPoints: c.smoothPoints,
  catalystPoints: c.catalystPoints,
  foulPoints: -c.foulPoints,
  roundSeconds: (c.maxTick * c.tickMs) / 1000,
  maxMoves: c.maxMoves,
});
const streamsOf = (seed: number) => ({
  deal: seedFromString(`refining:seed-${seed}:deal`),
  dealCatalyst: seedFromString(`refining:seed-${seed}:deal-catalyst`),
  feed: seedFromString(`refining:seed-${seed}:feed`),
  catalyst: seedFromString(`refining:seed-${seed}:catalyst`),
});
const CONFIGS: Record<string, RefiningConfig> = {
  "as shipped": DEFAULT_REFINING_CONFIG,
  // Much vapour, many catalysts and a short cap: long clear runs, capped, with catalysts paid.
  "rich feed, a short cap": { ...DEFAULT_REFINING_CONFIG, vapourPermille: 700, oilPermille: 150, catalystPermille: 120, runCap: 2, pulseTicks: 30 },
  // Much tar and smoke from every spill: fouls that take the score to nothing, dumps and spills.
  "heavy feed, smoke on every spill": { ...DEFAULT_REFINING_CONFIG, width: 4, height: 6, vapourPermille: 300, oilPermille: 200, smokeEvery: 1, foulPoints: 150, pulseTicks: 20 },
};

const shippedTower = (s: RefiningState): string[][] =>
  Array.from({ length: s.config.height }, (_, y) => Array.from({ length: s.config.width }, (_, x) => KINDS[s.cells[y * s.config.width + x]!.kind]!));

describe("Refining on the new engine, beside the engine the studio deals", () => {
  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`holds the same tower, run, score and counts, tick for tick: ${name}`, async () => {
      const seen = { clear: 0, smooth: 0, plain: 0, foul: 0, dump: 0, spill: 0, smoke: 0, early: 0, capped: 0, catalysts: 0, floored: 0 };
      for (let seed = 1; seed <= SEEDS; seed++) {
        await breathe();
        let shipped = createRefiningGame(`seed-${seed}`, config);
        let round: Round<SwapMove | DrawMove> = start(refining, { seed, settings: settingsOf(config), streams: streamsOf(seed) });
        let picks = seedFromString(`picks-${seed}`);
        const pick = (n: number): number => {
          const r = nextInt(picks, n);
          picks = r.state;
          return r.value;
        };
        const level = (where: string): void => {
          const now = read(round);
          expect(now.board.map((r) => r.map((p) => p!.piece)), where).toEqual(shippedTower(shipped));
          expect(now.score, where).toBe(shipped.score);
          expect(now.streak, where).toBe(shipped.run);
          expect(now.stats, where).toMatchObject({ draws: shipped.draws, clears: shipped.clears, smooths: shipped.smooths, fouls: shipped.fouls, dumps: shipped.dumps, spills: shipped.spills });
        };
        const tally = (events: RefiningState["events"]): void => {
          for (const e of events) {
            if (e.type !== "draw") continue;
            seen[e.value.grade]++;
            seen.smoke += e.smoke.length;
            if (e.early) seen.early++;
            if (e.value.grade === "clear" && e.value.run > config.runCap) seen.capped++;
            if ((e.value.grade === "clear" || e.value.grade === "smooth") && e.value.catalysts > 0) seen.catalysts++;
            if (e.value.points < 0 && e.points > e.value.points) seen.floored++;
          }
        };
        level(`seed ${seed}, the deal`);
        let tick = 0;
        const last = config.maxTick - 20;
        while (tick < last && !shipped.finished) {
          tick = Math.min(last, tick + pick(pick(6) === 0 ? 25 : 5));
          const where = `seed ${seed}, tick ${tick}`;
          const now = advanceRefining(shipped, tick);
          tally(now.events === shipped.events ? [] : now.events.slice(shipped.events.length));
          // Mostly the swap the shipped hint gives, now and then any legal swap, an early draw, or time passing.
          const kind = pick(12);
          const helps = refiningHint(now);
          const all = refiningLinks(now);
          const swap = helps && kind > 4 ? helps : kind > 1 && all.length > 0 ? all[pick(all.length)]! : null;
          if (kind === 0) {
            shipped = reduceRefining(now, { type: "draw", tick } as RefiningMove);
            round = play(round, { move: "draw" }, { at: tick * TICK });
          } else if (swap) {
            shipped = reduceRefining(now, { type: "swap", cell: swap.cell, dir: swap.dir, tick } as RefiningMove);
            round = play(round, { move: "swap", at: { x: swap.cell % config.width, y: Math.floor(swap.cell / config.width) }, dir: swap.dir === "upRight" ? 0 : 1 }, { at: tick * TICK });
          } else {
            shipped = now;
            round = advance(round, { at: tick * TICK });
            level(where);
            continue;
          }
          expect(round.last.refused, where).toBeNull();
          tally(shipped.lastMove!.events);
          level(where);
        }
      }
      // The comparison means something only if the rounds reached every rule.
      expect(seen.clear, "clear columns").toBeGreaterThan(0);
      expect(seen.foul, "foul columns").toBeGreaterThan(0);
      expect(seen.early, "early draws").toBeGreaterThan(0);
      expect(seen.spill + seen.dump, "columns that sank").toBeGreaterThan(0);
      if (name === "as shipped") expect(seen.smooth, "smooth columns").toBeGreaterThan(0), expect(seen.plain, "plain columns").toBeGreaterThan(0);
      if (name === "rich feed, a short cap") expect(seen.capped, "clear runs past the cap").toBeGreaterThan(0), expect(seen.catalysts, "catalysts paid").toBeGreaterThan(0);
      if (name === "heavy feed, smoke on every spill") expect(seen.smoke, "smoke").toBeGreaterThan(0), expect(seen.floored, "fouls the floor held").toBeGreaterThan(0);
    }, 180_000);
  }
});

describe("Refining as a puzzle of its own", () => {
  it("deals, plays and replays from its seed, settings and log", () => {
    for (let seed = 1; seed <= 3; seed++) {
      let round = start(refining, { seed });
      for (let m = 0; m < 40; m++) round = play(round, m % 5 === 0 ? { move: "draw" } : { move: "swap", at: { x: m % 5, y: m % 5 }, dir: m % 2 }, { at: m * 1500 });
      expect(read(round).stats.draws).toBeGreaterThan(0);
      expect(replay(refining, String(seed), {}, round.log).state).toEqual(round.state);
    }
  });

  it("refuses a swap off the tower, and one that goes the wrong way", () => {
    const round = start(refining, { seed: 1 });
    expect(play(round, { move: "swap", at: { x: 5, y: 0 }, dir: 0 }).last.refused).toBe("reason.not_linked");
    expect(play(round, { move: "swap", at: { x: 0, y: 0 }, dir: 7 }).last.refused).toBe("reason.not_linked");
  });

  it("is all there to read: its scoring declared, each hook explained", () => {
    const doc = JSON.parse(expand(refining)) as { payouts: { id: string }[]; round: { tempo: unknown }; streak: unknown };
    expect(doc.round.tempo).toEqual({ kind: "ticking", tickMs: 100 });
    expect(doc.payouts.map((p) => p.id)).toEqual(["clear", "smooth", "catalysts", "foul"]);
    expect(explain(refining)).toMatchInlineSnapshot(`
      "onStart    tower
      canMove    tower (swap)
      onMove     tower (swap, draw)
      onTick     tower
      listMoves  tower
      pointsFor  tower"
    `);
  });
});
