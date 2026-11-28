// Overload, played beside the engine the studio deals. Both are dealt from the same luck, and are held to the same
// bank, taps, score and streak after every stretch of ticks and every tap.
import { advanceOverload, createOverloadGame, DEFAULT_OVERLOAD_CONFIG, overloadHint, reduceOverload, type OverloadConfig, type OverloadMove, type OverloadState } from "@openseas/engine";
import { describe, expect, it } from "vitest";
import overload, { type TapMove } from "../examples/overload.puzzle.js";
import { advance, expand, explain, nextInt, play, read, replay, seedFromString, start, type Round, type Setting } from "../src/index.js";

const TICK = 100;
const SEEDS = Number(process.env.SEEDS ?? 6);
/** Hands the event loop back for a moment. */
const breathe = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

const settingsOf = (c: OverloadConfig): Record<string, Setting> => ({
  width: c.width,
  height: c.height,
  refill: c.refill,
  boosterPermille: c.boosterPermille,
  tapCap: c.tapCap,
  startTaps: c.startTaps,
  tapRegenTicks: c.tapRegenTicks,
  refundEvery: c.refundEvery,
  chainCap: c.chainCap,
  streakMin: c.streakMin,
  burstPoints: c.burstPoints,
  streakPercent: c.streakPercent,
  roundSeconds: (c.maxTick * c.tickMs) / 1000,
  maxMoves: c.maxMoves,
});
const CONFIGS: Record<string, OverloadConfig> = {
  "as shipped": DEFAULT_OVERLOAD_CONFIG,
  // A charged bank, many boosters and a low cap: long chains run past the cap, and give taps back.
  "a charged bank and a low cap": { ...DEFAULT_OVERLOAD_CONFIG, refill: [5, 15, 40, 40], boosterPermille: 150, chainCap: 6, streakMin: 6, burstPoints: 3, refundEvery: 3, streakPercent: [100, 150, 175] },
  "a wide bank, few taps": { ...DEFAULT_OVERLOAD_CONFIG, width: 9, height: 5, tapCap: 3, startTaps: 1, tapRegenTicks: 9, refundEvery: 0 },
};

const shippedBank = (s: OverloadState): { piece: string; state: number }[][] =>
  Array.from({ length: s.config.height }, (_, y) => Array.from({ length: s.config.width }, (_, x) => { const c = s.cells[y * s.config.width + x]!; return { piece: c.booster ? "booster" : "capacitor", state: c.charge }; }));

describe("Overload on the new engine, beside the engine the studio deals", () => {
  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`holds the same bank, taps, score and streak, tick for tick: ${name}`, async () => {
      const seen = { long: 0, short: 0, capped: 0, refunds: 0, streak: 0, dry: 0 };
      for (let seed = 1; seed <= SEEDS; seed++) {
        await breathe();
        let shipped = createOverloadGame(`seed-${seed}`, config);
        let round: Round<TapMove> = start(overload, { seed, settings: settingsOf(config), streams: { bank: seedFromString(`overload:seed-${seed}`) } });
        let picks = seedFromString(`picks-${seed}`);
        const pick = (n: number): number => {
          const r = nextInt(picks, n);
          picks = r.state;
          return r.value;
        };
        const level = (where: string): void => {
          const now = read(round);
          expect(now.board.map((r) => r.map((p) => ({ piece: p!.piece, state: p!.state }))), where).toEqual(shippedBank(shipped));
          expect(now.gauges.taps, where).toBe(shipped.taps);
          expect(now.score, where).toBe(shipped.score);
          expect(now.streak, where).toBe(shipped.combo);
          expect(now.stats, where).toMatchObject({ chains: shipped.chains, bursts: shipped.bursts, refunds: shipped.refunds });
        };
        level(`seed ${seed}, the deal`);
        let tick = 0;
        const last = config.maxTick - 20;
        while (tick < last && !shipped.finished) {
          tick = Math.min(last, tick + pick(pick(5) === 0 ? 30 : 6));
          const where = `seed ${seed}, tick ${tick}`;
          const now = advanceOverload(shipped, tick);
          // Mostly the tap the shipped hint gives, now and then any capacitor, or time passing.
          const helps = overloadHint(now);
          const kind = pick(10);
          const cell = helps && kind > 2 ? helps.cell : kind > 0 ? pick(config.width * config.height) : null;
          if (cell === null || now.taps < 1) {
            if (now.taps < 1) seen.dry++;
            shipped = now;
            round = advance(round, { at: tick * TICK });
          } else {
            shipped = reduceOverload(shipped, { type: "tap", cell, tick } as OverloadMove);
            round = play(round, { move: "tap", at: { x: cell % config.width, y: Math.floor(cell / config.width) } }, { at: tick * TICK });
            expect(round.last.refused, where).toBeNull();
            for (const e of shipped.lastMove!.events) {
              if (e.type !== "chain") continue;
              if (e.size >= config.streakMin) seen.long++;
              else seen.short++;
              if (e.size > config.chainCap) seen.capped++;
              seen.refunds += e.refund;
            }
            seen.streak = Math.max(seen.streak, shipped.combo);
          }
          level(where);
        }
      }
      // The comparison means something only if the rounds reached every rule.
      expect(seen.long, "long chains").toBeGreaterThan(3);
      expect(seen.short, "short chains").toBeGreaterThan(0);
      expect(seen.streak, "long chains in a row").toBeGreaterThan(1);
      if (name === "a charged bank and a low cap") expect(seen.capped, "chains past the cap").toBeGreaterThan(0), expect(seen.refunds, "taps given back").toBeGreaterThan(0);
      if (name === "a wide bank, few taps") expect(seen.dry, "times with no tap held").toBeGreaterThan(0);
    }, 180_000);
  }
});

describe("Overload as a puzzle of its own", () => {
  it("deals, plays and replays from its seed, settings and log", () => {
    for (let seed = 1; seed <= 3; seed++) {
      let round = start(overload, { seed });
      for (let m = 0; m < 60; m++) round = play(round, { move: "tap", at: { x: m % 6, y: (m * 5) % 7 } }, { at: m * 600 });
      expect(read(round).stats.chains).toBeGreaterThan(0);
      expect(replay(overload, String(seed), {}, round.log).state).toEqual(round.state);
    }
  });

  it("refuses a tap with none held, and a place off the bank", () => {
    let round = start(overload, { seed: 1, settings: { startTaps: 0 } });
    expect(play(round, { move: "tap", at: { x: 0, y: 0 } }).last.refused).toBe("reason.no_taps");
    round = start(overload, { seed: 1 });
    expect(play(round, { move: "tap", at: { x: 9, y: 0 } }).last.refused).toBe("reason.off_board");
  });

  it("is all there to read: its scoring declared, each hook explained", () => {
    const doc = JSON.parse(expand(overload)) as { payouts: { id: string }[]; round: { tempo: unknown }; streak: unknown };
    expect(doc.round.tempo).toEqual({ kind: "ticking", tickMs: 100 });
    expect(doc.payouts.map((p) => p.id)).toEqual(["chain"]);
    expect(doc.streak).toEqual({ builds: { event: "chain" }, counts: "events", grace: 0, breaksOn: ["short"] });
    expect(explain(overload)).toMatchInlineSnapshot(`
      "onStart    bank
      canMove    bank (tap)
      onMove     bank (tap)
      onTick     bank
      listMoves  bank"
    `);
  });
});
