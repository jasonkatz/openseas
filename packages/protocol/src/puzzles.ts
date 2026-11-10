import { z } from "zod";
import { BattleConfigSchema, BattleMoveSchema } from "./battle.js";
import { CoolingConfigSchema, CoolingMoveSchema } from "./cooling.js";
import { PlatingConfigSchema, PlatingMoveSchema } from "./plating.js";
import type { PuzzleIdWire } from "./common.js";
import { GunneryConfigSchema, GunneryMoveSchema } from "./gunnery.js";
import { NavigationConfigSchema, NavigationMoveSchema } from "./navigation.js";
import { EnginesConfigSchema, EnginesMoveSchema } from "./engines.js";
import { SwordfightConfigSchema, SwordfightMoveSchema } from "./swordfight.js";
import { SalvageConfigSchema, SalvageMoveSchema } from "./salvage.js";
import { OverloadConfigSchema, OverloadMoveSchema } from "./overload.js";
import { DeflectorsConfigSchema, DeflectorsMoveSchema } from "./deflectors.js";
import { ReactorConfigSchema, ReactorMoveSchema } from "./reactor.js";
import { ScannerConfigSchema, ScannerMoveSchema } from "./scanner.js";
import { TugConfigSchema, TugMoveSchema } from "./tug.js";
import { RacksConfigSchema, RacksMoveSchema } from "./racks.js";
import { CuttingConfigSchema, CuttingMoveSchema } from "./cutting.js";

/**
 * Per-puzzle wire schemas. The server validates a move against the schema of the session's puzzle,
 * so a Cooling swap sent to an Engines round is rejected as an illegal move, not accepted as junk.
 */
export const PUZZLE_MOVE_SCHEMAS = {
  cooling: CoolingMoveSchema,
  engines: EnginesMoveSchema,
  plating: PlatingMoveSchema,
  gunnery: GunneryMoveSchema,
  navigation: NavigationMoveSchema,
  battle: BattleMoveSchema,
  swordfight: SwordfightMoveSchema,
  salvage: SalvageMoveSchema,
  overload: OverloadMoveSchema,
  deflectors: DeflectorsMoveSchema,
  reactor: ReactorMoveSchema,
  scanner: ScannerMoveSchema,
  tug: TugMoveSchema,
  racks: RacksMoveSchema,
  cutting: CuttingMoveSchema,
} as const satisfies Record<PuzzleIdWire, z.ZodType>;

export const PUZZLE_CONFIG_SCHEMAS = {
  cooling: CoolingConfigSchema,
  engines: EnginesConfigSchema,
  plating: PlatingConfigSchema,
  gunnery: GunneryConfigSchema,
  navigation: NavigationConfigSchema,
  battle: BattleConfigSchema,
  swordfight: SwordfightConfigSchema,
  salvage: SalvageConfigSchema,
  overload: OverloadConfigSchema,
  deflectors: DeflectorsConfigSchema,
  reactor: ReactorConfigSchema,
  scanner: ScannerConfigSchema,
  tug: TugConfigSchema,
  racks: RacksConfigSchema,
  cutting: CuttingConfigSchema,
} as const satisfies Record<PuzzleIdWire, z.ZodType>;

/** Every puzzle's move shapes, for consumers that want the union type. Not used on the wire (see ws.ts). */
export const AnyMoveSchema = z.union([
  CoolingMoveSchema,
  EnginesMoveSchema,
  PlatingMoveSchema,
  GunneryMoveSchema,
  NavigationMoveSchema,
  BattleMoveSchema,
  SwordfightMoveSchema,
  SalvageMoveSchema,
  OverloadMoveSchema,
  DeflectorsMoveSchema,
  ReactorMoveSchema,
  ScannerMoveSchema,
  TugMoveSchema,
  RacksMoveSchema,
  CuttingMoveSchema,
]);
export type AnyMoveWire = z.infer<typeof AnyMoveSchema>;

export type MoveWireFor<P extends PuzzleIdWire> = z.infer<(typeof PUZZLE_MOVE_SCHEMAS)[P]>;
export type ConfigWireFor<P extends PuzzleIdWire> = z.infer<(typeof PUZZLE_CONFIG_SCHEMAS)[P]>;

export function parseMoveFor<P extends PuzzleIdWire>(puzzle: P, raw: unknown): MoveWireFor<P> | null {
  const r = PUZZLE_MOVE_SCHEMAS[puzzle].safeParse(raw);
  return r.success ? (r.data as MoveWireFor<P>) : null;
}
