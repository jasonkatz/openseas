import { SCANNER_DEF, type ScannerConfig, type ScannerMove, type ScannerState } from "@openseas/engine";
import { PUZZLE_CONFIG_SCHEMAS } from "@openseas/protocol";
import { content } from "@openseas/boards";
import type { HarnessPuzzle } from "../puzzles.js";
import { SCANNER_PRESETS } from "../scenario/prototypes/scanner.js";

/** What the bench needs to know about Scanner: its content config, presets and seed probes. */
export const SCANNER: HarnessPuzzle<ScannerState, ScannerMove, ScannerConfig> = {
  id: "scanner",
  def: SCANNER_DEF,
  config: content.puzzles.scanner.config,
  roundSeconds: content.puzzles.scanner.roundSeconds,
  configSchema: PUZZLE_CONFIG_SCHEMAS.scanner,
  presets: SCANNER_PRESETS,
  probes: [],
  locked: [],
  ticked: null,
  hints: false,
};
