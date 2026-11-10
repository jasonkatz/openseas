import type { Preset } from "../presets.js";

/** Lab presets for Deflectors. Every one must pass the engine's validator and the wire schema (test/scenario.test.ts). */
export const DEFLECTORS_PRESETS: readonly Preset[] = [
  { id: "deflectors_one_beam", overrides: { maxBeams: 1 } },
  { id: "deflectors_two_from_start", overrides: { rampTicks: 1 } },
  { id: "deflectors_three_beams", overrides: { maxBeams: 3, rampTicks: 300 } },
  { id: "deflectors_sparse", overrides: { mirrors: 10 } },
  { id: "deflectors_dense", overrides: { mirrors: 18 } },
  { id: "deflectors_big_grid", overrides: { size: 8, mirrors: 24 } },
  { id: "deflectors_long_count", overrides: { chargeTicks: 400, chargeTicksMin: 400 } },
  { id: "deflectors_short_round", overrides: { maxTick: 600 }, roundSeconds: 60 },
];
