/**
 * Prototype puzzles (ADR 0036): each has its own content file, schema and message file, so one is
 * promoted or removed by its own files and the lines here that name it.
 */
import type { z } from "zod";
import salvageData from "../../data/puzzles/salvage.json" with { type: "json" };
import salvageMessages from "../../data/messages/prototypes/salvage.json" with { type: "json" };
import { SalvageContentSchema, type SalvageContent } from "./salvage.js";
import overloadData from "../../data/puzzles/overload.json" with { type: "json" };
import overloadMessages from "../../data/messages/prototypes/overload.json" with { type: "json" };
import { OverloadContentSchema, type OverloadContent } from "./overload.js";
import deflectorsData from "../../data/puzzles/deflectors.json" with { type: "json" };
import deflectorsMessages from "../../data/messages/prototypes/deflectors.json" with { type: "json" };
import { DeflectorsContentSchema, type DeflectorsContent } from "./deflectors.js";
import reactorData from "../../data/puzzles/reactor.json" with { type: "json" };
import reactorMessages from "../../data/messages/prototypes/reactor.json" with { type: "json" };
import { ReactorContentSchema, type ReactorContent } from "./reactor.js";
import scannerData from "../../data/puzzles/scanner.json" with { type: "json" };
import scannerMessages from "../../data/messages/prototypes/scanner.json" with { type: "json" };
import { ScannerContentSchema, type ScannerContent } from "./scanner.js";
import tugData from "../../data/puzzles/tug.json" with { type: "json" };
import tugMessages from "../../data/messages/prototypes/tug.json" with { type: "json" };
import { TugContentSchema, type TugContent } from "./tug.js";
import racksData from "../../data/puzzles/racks.json" with { type: "json" };
import racksMessages from "../../data/messages/prototypes/racks.json" with { type: "json" };
import { RacksContentSchema, type RacksContent } from "./racks.js";
import cuttingData from "../../data/puzzles/cutting.json" with { type: "json" };
import cuttingMessages from "../../data/messages/prototypes/cutting.json" with { type: "json" };
import { CuttingContentSchema, type CuttingContent } from "./cutting.js";

export * from "./base.js";
export * from "./salvage.js";
export * from "./overload.js";
export * from "./deflectors.js";
export * from "./reactor.js";
export * from "./scanner.js";
export * from "./tug.js";
export * from "./racks.js";
export * from "./cutting.js";

/** Content for every prototype puzzle, keyed by puzzle id. */
export interface PrototypePuzzleContent {
  readonly salvage: SalvageContent;
  readonly overload: OverloadContent;
  readonly deflectors: DeflectorsContent;
  readonly reactor: ReactorContent;
  readonly scanner: ScannerContent;
  readonly tug: TugContent;
  readonly racks: RacksContent;
  readonly cutting: CuttingContent;
}
export type PrototypePuzzleContentId = keyof PrototypePuzzleContent;

/** Each prototype's file, its schema and its raw data, for the loader. */
export const PROTOTYPE_CONTENT: { readonly [K in PrototypePuzzleContentId]: { readonly schema: z.ZodType<PrototypePuzzleContent[K]>; readonly data: unknown; readonly messages: unknown } } = {
  salvage: { schema: SalvageContentSchema, data: salvageData, messages: salvageMessages },
  overload: { schema: OverloadContentSchema, data: overloadData, messages: overloadMessages },
  deflectors: { schema: DeflectorsContentSchema, data: deflectorsData, messages: deflectorsMessages },
  reactor: { schema: ReactorContentSchema, data: reactorData, messages: reactorMessages },
  scanner: { schema: ScannerContentSchema, data: scannerData, messages: scannerMessages },
  tug: { schema: TugContentSchema, data: tugData, messages: tugMessages },
  racks: { schema: RacksContentSchema, data: racksData, messages: racksMessages },
  cutting: { schema: CuttingContentSchema, data: cuttingData, messages: cuttingMessages },
};
export const PROTOTYPE_PUZZLE_CONTENT_IDS = Object.keys(PROTOTYPE_CONTENT) as PrototypePuzzleContentId[];
