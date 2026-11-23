import { describe, expect, test } from "vitest";
import { checkWitness, judge, replay, SWAP, SWAP_WITNESSES, swapEngine } from "../src/index.js";
import { SCALE, swap } from "./helpers.js";

describe("witness rounds", () => {
  test("Swap keeps a few", () => {
    expect(SWAP_WITNESSES.length).toBeGreaterThanOrEqual(5);
    expect(new Set(SWAP_WITNESSES.map((w) => w.layers.join(","))).size).toBe(SWAP.ladder.length);
  });

  test.each(SWAP_WITNESSES.map((w) => [w.name, w] as const))("%s still gives the read recorded for it", (_name, witness) => {
    // A failure here means the change raises Swap's major: raise it, add its history line, and
    // record the witness rounds again with `pnpm --filter @openseas/puzzle witness`.
    expect(checkWitness(swap, witness)).toEqual([]);
  });

  test("a witness that no longer gives its read is caught", () => {
    const w = SWAP_WITNESSES[0]!;
    expect(checkWitness(swap, { ...w, read: { ...w.read, score: w.read.score + 1 } })[0]).toMatch(/now scores/);
    expect(checkWitness(swap, { ...w, seed: `${w.seed}!` }).length).toBeGreaterThan(0);
    expect(checkWitness(swap, { ...w, hash: "00000000" })).toEqual([`${w.name} ends as a different round`]);
    expect(checkWitness(swap, { ...w, version: "1.0" })[0]).toMatch(/record the witness rounds again/);
  });

  test("every witness is a round a host would judge, and judges to what it read", () => {
    for (const w of SWAP_WITNESSES) {
      const stored = judge(swap, w);
      expect(stored).toMatchObject({ puzzle: "swap", version: SWAP.version, score: w.read.score, tier: w.read.tier });
      // A stored round keeps every setting's value, so a later default cannot change what it was.
      expect(Object.keys(stored.settings).sort()).toEqual(Object.keys(swap.settings({ layers: w.layers }).values).sort());
    }
  });

  test("across them the rules use every part the puzzle declares", () => {
    const used = new Set<string>();
    const traced = swapEngine({ scale: SCALE, trace: (kind, id) => void used.add(`${kind}.${id}`) });
    for (const w of SWAP_WITNESSES) traced.read(replay(traced, w).round);
    // The settings the engine reads itself, to size the clock, the board and a gauge, are not the rules' to use.
    const engines = ["roundSeconds", "width", "height", "dangerRows"];
    const want = [
      ...SWAP.settings.filter((s) => !engines.includes(s.id)).map((s) => `settings.${s.id}`),
      ...SWAP.deal.draws.map((d) => `draws.${d.id}`),
      ...SWAP.pieces.map((p) => `pieces.${p.id}`),
      ...SWAP.moves.map((m) => `moves.${m.id}`),
      ...SWAP.events.map((e) => `events.${e.id}`),
      ...SWAP.payouts.map((p) => `payouts.${p.id}`),
      ...SWAP.multipliers.map((m) => `multipliers.${m.id}`),
      ...SWAP.signals.in.map((s) => `signals.${s.id}`),
      ...SWAP.gauges.map((g) => `gauges.${g.id}`),
      ...SWAP.stats.map((s) => `stats.${s.id}`),
    ];
    expect(want.filter((id) => !used.has(id))).toEqual([]);
  });

  test("the score is broken down by payout, and none is the whole of a good round", () => {
    const w = SWAP_WITNESSES[0]!;
    const share = Math.max(...Object.values(w.read.paid)) / w.read.score;
    expect(Object.values(w.read.paid).reduce((a, b) => a + b, 0)).toBe(w.read.score);
    expect(share).toBeLessThan(0.75);
  });
});
