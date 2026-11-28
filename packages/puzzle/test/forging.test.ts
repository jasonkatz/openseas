// Forging, played beside the engine the studio deals. Both are dealt from the same luck, and are held to the same
// plate, chain, weave and score after every strike.
import { createForgingGame, DEFAULT_FORGING_CONFIG, forgingHint, forgingTargets, reduceForging, type ForgingConfig, type ForgingState } from "@openseas/engine";
import { describe, expect, it } from "vitest";
import forging, { type Anvil, type StrikeMove } from "../examples/forging.puzzle.js";
import { expand, explain, listMoves, nextInt, play, read, replay, seedFromString, start, type Round, type Setting } from "../src/index.js";

const SEEDS = Number(process.env.SEEDS ?? 20);
/** Hands the event loop back for a moment. */
const breathe = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

const settingsOf = (c: ForgingConfig): Record<string, Setting> => ({
  width: c.width,
  height: c.height,
  maxMoves: c.maxMoves,
  blows: c.blows,
  jumps: c.jumps,
  far: c.far,
  sparks: c.sparks,
  weights: c.weights,
  strikePoints: c.strikePoints,
  platePoints: c.platePoints,
  chainPoints: c.chainPoints,
  chainCap: c.chainCap,
  setPoints: c.setPoints,
  weaveCap: c.weaveCap,
});
const CONFIGS: Record<string, ForgingConfig> = {
  "as shipped": DEFAULT_FORGING_CONFIG,
  // A small plate struck once a spot, sparks off: plates set whole, and sets that weave.
  "a small plate, one blow": { ...DEFAULT_FORGING_CONFIG, width: 4, height: 4, blows: 1, sparks: false, weaveCap: 3 },
  // Steps only, of one to three, many blows: long chains, counts, and no spans.
  "steps only": { ...DEFAULT_FORGING_CONFIG, width: 5, height: 7, blows: 4, jumps: false, chainCap: 6, weights: [20, 5, 5, 8, 8, 8, 6, 8] },
  "no sets": { ...DEFAULT_FORGING_CONFIG, setPoints: 0, strikePoints: 3 },
};

const shippedPlate = (s: ForgingState): ({ piece: string; state: number } | null)[][] =>
  Array.from({ length: s.config.height }, (_, y) => Array.from({ length: s.config.width }, (_, x) => { const c = s.cells[y * s.config.width + x]!; return c.heat > 0 ? { piece: c.mark, state: c.heat } : null; }));

describe("Forging on the new engine, beside the engine the studio deals", () => {
  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`holds the same plate, chain, weave and score, strike for strike: ${name}`, async () => {
      const seen = { sets: 0, woven: 0, chains: 0, sparks: 0, plates: 0, stalls: 0, broke: 0 };
      for (let seed = 1; seed <= SEEDS; seed++) {
        await breathe();
        let shipped = createForgingGame(`seed-${seed}`, config);
        let round: Round<StrikeMove> = start(forging, { seed, settings: settingsOf(config), streams: { marks: seedFromString(`forging:seed-${seed}`) } });
        let picks = seedFromString(`picks-${seed}`);
        const pick = (n: number): number => {
          const r = nextInt(picks, n);
          picks = r.state;
          return r.value;
        };
        const level = (where: string): void => {
          const now = read(round);
          const anvil = (now.state as { anvil: Anvil }).anvil;
          expect(now.board.map((r) => r.map((p) => (p ? { piece: p.piece, state: p.state } : null))), where).toEqual(shippedPlate(shipped));
          expect(now.score, where).toBe(shipped.score);
          expect({ chain: anvil.chain, chainMark: anvil.chainMark, run: anvil.run, weave: anvil.weave, weaveFamily: anvil.weaveFamily }, where).toEqual({ chain: shipped.chain, chainMark: shipped.chainMark, run: shipped.run, weave: shipped.weave, weaveFamily: shipped.weaveFamily });
          expect(now.stats, where).toMatchObject({ strikes: shipped.moveCount, sets: shipped.sets, sparks: shipped.sparksEarned, bestChain: shipped.bestChain, bestWeave: shipped.bestWeave });
        };
        level(`seed ${seed}, the deal`);
        while (!shipped.finished) {
          const where = `seed ${seed}, strike ${shipped.moveCount + 1}`;
          // The strike the shipped hint gives, the one that leaves the press most places to land, or any it can reach.
          const all = forgingTargets(shipped);
          const helps = forgingHint(shipped);
          // A planner: a set first, then a strike that grows the set in the making, then room to land.
          const worth = (c: number): number => {
            const after = reduceForging(shipped, { type: "strike", cell: c });
            const r = after.lastMove!;
            return r.stalled ? -1 : (r.set ? 1000 * r.set.weave : 0) + (after.run.length > shipped.run.length ? 100 : 0) + forgingTargets(after).length;
          };
          const roomy = all.map((c) => ({ c, worth: worth(c) })).sort((a, b) => b.worth - a.worth)[0]!.c;
          const kind = pick(10);
          const at = kind < 3 && helps !== null ? helps : kind < 9 ? roomy : all[pick(all.length)]!;
          expect(listMoves(round).map((m) => (m as StrikeMove).at).map((p) => p.y * config.width + p.x).sort((a, b) => a - b), where).toEqual(all);
          shipped = reduceForging(shipped, { type: "strike", cell: at });
          round = play(round, { move: "strike", at: { x: at % config.width, y: Math.floor(at / config.width) } });
          expect(round.last.refused, where).toBeNull();
          const r = shipped.lastMove!;
          if (r.set) seen.sets++, r.set.weave > 1 && seen.woven++;
          if (r.chain > 1) seen.chains++;
          if (r.sparked) seen.sparks++;
          if (r.done) seen.plates++;
          if (r.stalled) seen.stalls++;
          if (r.broke) seen.broke++;
          expect(round.last.events.some((e) => e.event === "stall"), where).toBe(r.stalled);
          level(where);
        }
        if (shipped.moveCount < config.maxMoves) expect(listMoves(round), `seed ${seed}, the end`).toEqual([]);
      }
      // The comparison means something only if the rounds reached every rule.
      expect(seen.chains, "chains").toBeGreaterThan(0);
      expect(seen.stalls + seen.plates, "rounds that ended on the plate").toBe(SEEDS);
      if (name === "as shipped" || name === "steps only") expect(seen.sets, "sets").toBeGreaterThan(0), expect(seen.broke, "sets broken").toBeGreaterThan(0);
      if (name === "as shipped") expect(seen.sparks, "sparks").toBeGreaterThan(0), expect(seen.woven, "sets woven").toBeGreaterThan(0);
    }, 180_000);
  }
});

describe("Forging's whole plate, beside the engine the studio deals", () => {
  it("pays a plate set whole the same, found by searching every strike", () => {
    const config: ForgingConfig = { ...DEFAULT_FORGING_CONFIG, width: 4, height: 4, blows: 1 };
    let plates = 0;
    for (const seed of [1, 3, 5, 10]) {
      // Depth first through every strike the engine allows, to a round that sets every spot.
      const search = (s: ForgingState, path: number[]): number[] | null => {
        if (s.lastMove?.done) return path;
        if (s.finished) return null;
        for (const c of forgingTargets(s)) {
          const found = search(reduceForging(s, { type: "strike", cell: c }), [...path, c]);
          if (found) return found;
        }
        return null;
      };
      let shipped = createForgingGame(`seed-${seed}`, config);
      const path = search(shipped, [])!;
      let round: Round<StrikeMove> = start(forging, { seed, settings: settingsOf(config), streams: { marks: seedFromString(`forging:seed-${seed}`) } });
      for (const at of path) {
        shipped = reduceForging(shipped, { type: "strike", cell: at });
        round = play(round, { move: "strike", at: { x: at % 4, y: Math.floor(at / 4) } });
        expect(round.last.refused).toBeNull();
        expect(read(round).score, `seed ${seed}`).toBe(shipped.score);
      }
      expect(shipped.lastMove!.done).toBe(true);
      expect(round.last.events.some((e) => e.event === "plate")).toBe(true);
      expect(listMoves(round)).toEqual([]);
      plates++;
    }
    expect(plates).toBe(4);
  });
});

describe("Forging as a puzzle of its own", () => {
  it("deals, plays and replays from its seed, settings and log", () => {
    for (let seed = 1; seed <= 3; seed++) {
      let round = start(forging, { seed });
      for (let m = 0; m < 60 && listMoves(round).length > 0; m++) round = play(round, listMoves(round)[m % listMoves(round).length] as StrikeMove);
      expect(read(round).stats.strikes).toBeGreaterThan(0);
      expect(replay(forging, String(seed), {}, round.log).state).toEqual(round.state);
    }
  });

  it("refuses a strike the press cannot reach", () => {
    let round = start(forging, { seed: 1 });
    round = play(round, { move: "strike", at: { x: 0, y: 0 } });
    const reachable = (listMoves(round) as StrikeMove[]).map((m) => m.at.y * 6 + m.at.x);
    const out = Array.from({ length: 36 }, (_, i) => i).find((i) => !reachable.includes(i))!;
    expect(play(round, { move: "strike", at: { x: out % 6, y: Math.floor(out / 6) } }).last.refused).toBe("reason.out_of_reach");
  });

  it("is all there to read: its scoring declared, each hook explained", () => {
    const doc = JSON.parse(expand(forging)) as { payouts: { id: string }[]; round: { tempo: unknown } };
    expect(doc.round.tempo).toEqual({ kind: "still" });
    expect(doc.payouts.map((p) => p.id)).toEqual(["strike", "chain", "set", "plate"]);
    expect(explain(forging)).toMatchInlineSnapshot(`
      "onStart    anvil
      canMove    anvil (strike)
      onMove     anvil (strike)
      listMoves  anvil"
    `);
  });
});
