import type { Preset } from "../presets.js";

/** Lab presets for Assembly. Every one must pass the engine's validator and the wire schema (test/scenario.test.ts). */
export const ASSEMBLY_PRESETS: readonly Preset[] = [
  { id: "assembly_no_panels", overrides: { kindWeights: [0, 34, 33, 33] } },
  { id: "assembly_stiff", overrides: { kindWeights: [50, 17, 17, 16] } },
  { id: "assembly_small_prints", overrides: { sizeWeights: [1, 0, 0] } },
  { id: "assembly_big_prints", overrides: { sizeWeights: [1, 2, 6] } },
  { id: "assembly_three_tray", overrides: { traySize: 3 } },
  { id: "assembly_core_rush", overrides: { corePermille: 120, maxCores: 6, startCores: 4 } },
  { id: "assembly_wide_bay", overrides: { width: 8, height: 10 } },
];
