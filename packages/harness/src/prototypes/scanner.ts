import { SCANNER_DEF, scannerDistance, scannerProvenCells, type ScannerConfig, type ScannerMove, type ScannerState } from "@openseas/engine";
import { content } from "@openseas/boards";
import type { HarnessPuzzle } from "../puzzles.js";
import { SCANNER_PRESETS } from "../scenario/prototypes/scanner.js";

/** What the bench needs to know about Scanner: its content config, presets and seed probes. */
export const SCANNER: HarnessPuzzle<ScannerState, ScannerMove, ScannerConfig> = {
  id: "scanner",
  def: SCANNER_DEF,
  config: content.puzzles.scanner.config,
  roundSeconds: content.puzzles.scanner.roundSeconds,
  presets: SCANNER_PRESETS,
  probes: [
    { id: "wide_open", test: (s) => (s.pings[0]?.distance ?? 0) >= 5 },
    { id: "one_ring", test: (s) => scannerProvenCells(s).length > 0 },
    { id: "huddle", test: (s) => s.contacts.some((a) => s.contacts.some((b) => scannerDistance(s.config, a, b) === 1)) },
  ],
  locked: [],
  ticked: null,
  hints: true,
};
