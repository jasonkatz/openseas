import { SCANNER_DEF, scannerDistance, scannerProvenCells, type ScannerConfig, type ScannerMove, type ScannerState } from "@openseas/engine";
import { PUZZLE_CONFIG_SCHEMAS } from "@openseas/protocol";
import { content } from "@openseas/boards";
import type { HarnessPuzzle } from "../puzzles.js";
import { SCANNER_PRESETS } from "../scenario/prototypes/scanner.js";

/** What the studio needs to know about Scanner: its content config and its starting points. */
export const SCANNER: HarnessPuzzle<ScannerState, ScannerMove, ScannerConfig> = {
  id: "scanner",
  def: SCANNER_DEF,
  config: content.puzzles.scanner.config,
  roundSeconds: content.puzzles.scanner.roundSeconds,
  configSchema: PUZZLE_CONFIG_SCHEMAS.scanner,
  presets: SCANNER_PRESETS,
  locked: [],
  ticked: null,
};
