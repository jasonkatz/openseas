/**
 * Records Swap's witness rounds again (docs/puzzles/DOMAIN.md, "Witness rounds"). A witness round
 * is a seed, settings, a log and the read it must give; `test/witness.test.ts` fails when the rules
 * no longer give it. Run this only with a change that raises the puzzle's major: that is what
 * recording them again means.
 */
import { writeFileSync } from "node:fs";
import { test } from "vitest";
import { recordWitness } from "../src/index.js";
import { run, swap, type Plan } from "../test/helpers.js";

const PLANS: Readonly<Record<string, Plan>> = {
  "greedy, the whole puzzle": { seed: "witness-1", every: 1200, how: "greedy" },
  "careless, the whole puzzle": { seed: "witness-2", every: 400, how: "careless" },
  "greedy, with the line set by signals": { seed: "witness-3", every: 1500, how: "greedy", levels: [[0, 5], [45_000, 9], [90_000, 2]] },
  "greedy, stage runs": { seed: "witness-4", stage: "runs", every: 1500, how: "greedy" },
  "greedy, stage chains": { seed: "witness-5", stage: "chains", every: 1500, how: "greedy" },
  "greedy, stage specials": { seed: "witness-6", stage: "specials", every: 1500, how: "greedy" },
  "greedy, other settings": {
    seed: "witness-7",
    every: 1000,
    how: "greedy",
    values: { roundSeconds: 60, width: 8, height: 8, kinds: 5, burstPermille: 60, sweepPermille: 40, floatPermille: 80, startRows: 4, minRows: 1, dangerRows: 5, cascadePercent: [100, 150], streakPercent: [100, 125, 150, 200] },
  },
};

test("record the witness rounds", () => {
  const rounds = Object.entries(PLANS).map(([name, plan]) => {
    const ran = run(swap, plan);
    return recordWitness(swap, name, { seed: plan.seed, layers: ran.layers, settings: ran.settings, log: ran.log });
  });
  const file = new URL("../src/puzzles/swap/witness.json", import.meta.url).pathname;
  writeFileSync(file, `[\n${rounds.map((r) => `  ${JSON.stringify(r)}`).join(",\n")}\n]\n`);
});
