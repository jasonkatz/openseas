import type { Preset } from "../presets.js";

/** Lab presets for Scanner. Every one must pass the engine's validator and the wire schema (test/scenario.test.ts). */
export const SCANNER_PRESETS: readonly Preset[] = [
  { id: "scanner_first_deal", overrides: { dealTries: 1 } },
  { id: "scanner_dense", overrides: { startContacts: 5, maxContacts: 7, growEvery: 1 } },
  { id: "scanner_big_sector", overrides: { width: 8, height: 8, startContacts: 4, maxContacts: 8, growEvery: 1 } },
  { id: "scanner_tight_par", overrides: { parBase: 2, parPerContact: 1 } },
  { id: "scanner_no_opening", overrides: { openingMin: 0 } },
  { id: "scanner_ten_moves", overrides: { maxMoves: 10 }, roundSeconds: 60 },
];
