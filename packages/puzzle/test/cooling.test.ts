// Rungs 2 and 3 are proved by a real puzzle: Cooling, written as data and two parts, played beside the
// engine the game ships. Both start from the same board with the same luck to come, and are held to the
// same board, score, streak and heat after every move.
import { createCoolingGame, DEFAULT_COOLING_CONFIG, previewSwap, reduceCooling, Special, type CoolingConfig, type CoolingState } from "@openseas/engine";
import { describe, expect, it } from "vitest";
import cooling from "../examples/cooling.puzzle.js";
import { expand, explain, nextInt, play, read, replay, seedFromString, signal, start, type NewPiece, type Round, type Setting } from "../src/index.js";

const SPECIALS: Record<number, string> = { [Special.Charge]: "charge", [Special.Magnet]: "magnet", [Special.Slag]: "slag" };
const pieceOf = (kind: number): NewPiece => (kind in SPECIALS ? { piece: SPECIALS[kind]! } : { piece: "kind", kind: kind + 1 });
/** The shipped board as the new engine holds one: row by row from the top. */
const boardOf = (s: CoolingState): NewPiece[][] =>
  Array.from({ length: s.config.height }, (_, y) => Array.from({ length: s.config.width }, (_, x) => pieceOf(s.cells[(s.config.height - 1 - y) * s.config.width + x]!.kind)));
/** The shipped numbers as the new puzzle's settings. A streak that adds a step a move, up to a cap, is a table of percents. */
function settingsOf(c: CoolingConfig): Record<string, Setting> {
  const streak: number[] = [];
  for (let n = 0; streak.at(-1) !== c.streakMaxPercent && n < 64; n++) streak.push(Math.min(c.streakMaxPercent, 100 + n * c.streakStepPercent));
  return {
    width: c.width,
    height: c.height,
    kinds: c.pieceKinds,
    maxMoves: c.maxMoves,
    chargePermille: c.specialChancePerMille.charge,
    magnetPermille: c.specialChancePerMille.magnet,
    slagPermille: c.specialChancePerMille.slag,
    heatStartRow: c.initialHeatRow,
    heatLeastRow: c.minHeatRow,
    heatRiseMoves: c.heatRisePerMoves,
    heatFallPoints: c.heatDropPerPoints,
    shipHeat: c.shipHeat,
    streakGrace: c.streakGrace,
    cascadePercent: c.cascadeMultipliers.map((m) => m * 100),
    streakPercent: streak,
  };
}
const CONFIGS: Record<string, CoolingConfig> = {
  "as shipped": { ...DEFAULT_COOLING_CONFIG, shipHeat: false },
  // Few kinds make long cascades, and many specials make every rule of the two parts meet the others.
  "few kinds, many specials": { ...DEFAULT_COOLING_CONFIG, shipHeat: false, pieceKinds: 4, specialChancePerMille: { charge: 60, magnet: 50, slag: 90 }, cascadeMultipliers: [1, 3, 5, 7], streakStepPercent: 25, streakMaxPercent: 225, streakGrace: 0 },
  "a small board with fast heat": { ...DEFAULT_COOLING_CONFIG, shipHeat: false, width: 5, height: 8, pieceKinds: 5, specialChancePerMille: { charge: 20, magnet: 20, slag: 150 }, initialHeatRow: 6, minHeatRow: 1, heatRisePerMoves: 2, heatDropPerPoints: 7, streakGrace: 2 },
};

describe("Cooling on the new engine, beside the engine the game ships", () => {
  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`holds the same board, score, streak and heat after every move: ${name}`, () => {
      const seen = { moves: 0, points: 0, steps: 0, burst: 0, wipe: 0, scrap: 0, lift: 0, deepest: 0 };
      for (let seed = 1; seed <= 12; seed++) {
        let shipped = createCoolingGame(`seed-${seed}`, config);
        let round: Round = start(cooling, { seed, settings: settingsOf(config), board: boardOf(shipped), streams: { rise: shipped.rng } });
        let picks = seedFromString(`picks-${seed}`);
        const pick = (n: number): number => {
          const r = nextInt(picks, n);
          picks = r.state;
          return r.value;
        };
        for (let m = 0; m < 120; m++) {
          // Most moves are ones that clear something, so streaks build and cascades run. The rest are any swap at all.
          let col = pick(config.width - 1), row = pick(config.height);
          for (let t = 0; t < 40 && pick(4) > 0 && previewSwap(shipped, col, row).cells.length === 0; t++) (col = pick(config.width - 1)), (row = pick(config.height));
          shipped = reduceCooling(shipped, { type: "swap", col, row });
          const y = config.height - 1 - row;
          round = play(round, { move: "swap", a: { x: col, y }, b: { x: col + 1, y } });
          const where = `seed ${seed}, move ${m + 1}`;
          expect(round.last.refused, where).toBeNull();
          const report = shipped.lastMove!;
          // Step by step: what each step paid before the streak, then what the move banked.
          const steps = new Map<number, number>();
          for (const e of round.last.events) if (e.step !== undefined) steps.set(e.step, (steps.get(e.step) ?? 0) + e.points!);
          expect([...steps.values()], where).toEqual(report.rounds.map((r) => r.points));
          expect(round.last.banked, where).toBe(report.points);
          const now = read(round);
          expect(now.score, where).toBe(shipped.score);
          expect(now.streak, where).toBe(shipped.combo);
          expect((now.state as { heat: { heat: number } }).heat.heat, where).toBe(shipped.heat);
          expect(now.board.map((r) => r.map((p) => ({ piece: p!.piece, ...(p!.kind === undefined ? {} : { kind: p!.kind }) }))), where).toEqual(boardOf(shipped));
          seen.moves++;
          seen.points += report.points;
          seen.steps += report.rounds.length;
          seen.deepest = Math.max(seen.deepest, report.rounds.length);
          for (const e of round.last.events) if (e.event in seen) seen[e.event as "burst"]++;
        }
      }
      // The comparison means something only if the rounds reached every rule.
      expect(seen.points).toBeGreaterThan(1000);
      expect(seen.deepest).toBeGreaterThan(2);
      for (const event of ["burst", "wipe", "lift"] as const) expect(seen[event], event).toBeGreaterThan(0);
      if (name !== "as shipped") expect(seen.scrap).toBeGreaterThan(0);
    });
  }
});

describe("Cooling aboard a ship, its heat a signal from outside the board", () => {
  it("holds the same board, score, streak and heat when the ship's heat comes in between moves", () => {
    const config: CoolingConfig = { ...DEFAULT_COOLING_CONFIG, shipHeat: true, specialChancePerMille: { charge: 12, magnet: 8, slag: 120 } };
    const seen = { levels: 0, lifts: 0, signalled: 0 };
    for (let seed = 1; seed <= 8; seed++) {
      let shipped = createCoolingGame(`seed-${seed}`, config);
      let round: Round = start(cooling, { seed, settings: settingsOf(config), board: boardOf(shipped), streams: { rise: shipped.rng } });
      let picks = seedFromString(`ship-${seed}`);
      const pick = (n: number): number => {
        const r = nextInt(picks, n);
        picks = r.state;
        return r.value;
      };
      for (let m = 0; m < 80; m++) {
        const where = `seed ${seed}, entry ${m + 1}`;
        if (pick(4) === 0) {
          // The ship's turn sets the heat: no move, so the streak, the clock and the budget stand as they were.
          const row = pick(config.height + 1);
          const before = read(round);
          shipped = reduceCooling(shipped, { type: "heat", row });
          round = signal(round, { signal: "level", value: row }, { at: round.state.time });
          expect(round.last.events.map((e) => e.event), where).toEqual(["level"]);
          expect([read(round).movesMade, read(round).streak, read(round).score], where).toEqual([before.movesMade, before.streak, before.score]);
          seen.levels++;
        } else {
          let col = pick(config.width - 1), row = pick(config.height);
          for (let t = 0; t < 40 && pick(4) > 0 && previewSwap(shipped, col, row).cells.length === 0; t++) (col = pick(config.width - 1)), (row = pick(config.height));
          shipped = reduceCooling(shipped, { type: "swap", col, row });
          round = play(round, { move: "swap", a: { x: col, y: config.height - 1 - row }, b: { x: col + 1, y: config.height - 1 - row } });
          expect(round.last.refused, where).toBeNull();
          expect(round.last.banked, where).toBe(shipped.lastMove!.points);
          const lifts = round.last.events.filter((e) => e.event === "lift").length;
          seen.lifts += lifts;
          if (lifts > 0 && round.log.at(-2) && "signal" in round.log.at(-2)!) seen.signalled++;
        }
        const now = read(round);
        expect(now.score, where).toBe(shipped.score);
        expect(now.streak, where).toBe(shipped.combo);
        expect((now.state as { heat: { heat: number } }).heat.heat, where).toBe(shipped.heat);
        expect(now.board.map((r) => r.map((p) => ({ piece: p!.piece, ...(p!.kind === undefined ? {} : { kind: p!.kind }) }))), where).toEqual(boardOf(shipped));
      }
      // The log keeps the signals beside the moves, so a round dealt from the seed alone replays with them.
      const own = round.log.reduce((r, e) => ("signal" in e ? signal(r, e.signal, { at: e.at }) : play(r, e.move as never, { at: e.at })), start(cooling, { seed, settings: settingsOf(config) }));
      expect(own.log.filter((e) => "signal" in e).length).toBeGreaterThan(0);
      expect(replay(cooling, String(seed), settingsOf(config), own.log).state).toEqual(own.state);
    }
    expect(seen.levels).toBeGreaterThan(50);
    expect(seen.lifts, "slag lifted under the ship's heat").toBeGreaterThan(0);
  });

  it("takes no level while the board keeps its own heat", () => {
    const round = signal(start(cooling, { seed: 1 }), { signal: "level", value: 9 });
    expect(round.last.events).toEqual([]);
    expect(() => signal(round, { signal: "level", value: 13 })).toThrow("signal level: 13 is not a whole number from 0 to height");
  });
});

describe("Cooling as a puzzle of its own", () => {
  it("deals, plays and replays from its seed, settings and log", () => {
    for (let seed = 1; seed <= 6; seed++) {
      let round = start(cooling, { seed, settings: { maxMoves: 25 } });
      expect(read(round).board.flat().every(Boolean)).toBe(true);
      for (let m = 0; !read(round).ended; m++) round = play(round, { move: "swap", a: { x: (m * 7 + seed) % 5, y: (m * 5) % 12 }, b: { x: ((m * 7 + seed) % 5) + 1, y: (m * 5) % 12 } }, { at: m * 900 });
      expect(read(round).ended).toBe("moves");
      const again = replay(cooling, String(seed), { maxMoves: 25 }, round.log);
      expect(again.state).toEqual(round.state);
    }
  });

  it("ends on its clock: a move made after it is refused, and a read told the time says so", () => {
    const round = start(cooling, { seed: 1, settings: { roundSeconds: 30 } });
    const swap = { move: "swap", a: { x: 0, y: 0 }, b: { x: 1, y: 0 } } as const;
    const played = play(round, swap, { at: 29_999 });
    expect(played.last.refused).toBeNull();
    expect(read(played).msLeft).toBe(1);
    expect(read(played).ended).toBeNull();
    expect(read(played, { at: 30_000 }).ended).toBe("clock");
    expect(play(played, swap, { at: 30_000 }).last.refused).toBe("reason.round_over");
    expect(() => play(played, swap, { at: 5 })).toThrow("a move at 5 cannot follow one at 29999");
  });

  it("holds a swap to its row", () => {
    const round = start(cooling, { seed: 1 });
    expect(play(round, { move: "swap", a: { x: 0, y: 0 }, b: { x: 0, y: 1 } }).last.refused).toBe("reason.along_row");
  });

  it("is all there to read: every number a setting, every payout and multiplier declared, each hook explained", () => {
    const doc = JSON.parse(expand(cooling)) as { settings: { id: string }[]; payouts: { id: string }[]; multipliers: { id: string }[]; streak: unknown; round: { ends: { id: string }[] } };
    expect(doc.payouts.map((p) => p.id)).toEqual(["group", "trim", "scrap", "burst", "wipe", "lift"]);
    expect(doc.multipliers.map((m) => m.id)).toEqual(["cascade", "streak"]);
    expect(doc.streak).toEqual({ builds: { event: "clear or scrap or burst or wipe or lift" }, grace: "streakGrace", breaksOn: [] });
    expect(doc.round.ends.map((e) => e.id)).toEqual(["clock", "moves"]);
    expect(explain(cooling)).toMatchInlineSnapshot(`
      "onStart    refill, then heat   [every part, in the order listed]
      onFallback refill
      canMove    swap (swap)
      onMove     swap (swap), then specials (swap)   [every part with a say on the move, in order]
      onCascade  lines, then refill   [parts in order: the first to report anything ends the step]
      onMoveEnd  heat
      onSignal   heat (level)
      listMoves  swap"
    `);
  });
});
