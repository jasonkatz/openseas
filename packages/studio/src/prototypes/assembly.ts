import { ASSEMBLY_DEF, type AssemblyConfig, type AssemblyMove, type AssemblyState } from "@openseas/engine";
import { PUZZLE_CONFIG_SCHEMAS } from "@openseas/protocol";
import { content } from "@openseas/boards";
import type { StudioPuzzle } from "../puzzles.js";
import { ASSEMBLY_PRESETS } from "../scenario/prototypes/assembly.js";

/** What the studio needs to know about Assembly: its content config and its starting points. */
export const ASSEMBLY: StudioPuzzle<AssemblyState, AssemblyMove, AssemblyConfig> = {
  id: "assembly",
  def: ASSEMBLY_DEF,
  config: content.puzzles.assembly.config,
  roundSeconds: content.puzzles.assembly.roundSeconds,
  configSchema: PUZZLE_CONFIG_SCHEMAS.assembly,
  presets: ASSEMBLY_PRESETS,
  locked: [],
  ticked: null,
};
