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
import tractorData from "../../data/puzzles/tractor.json" with { type: "json" };
import tractorMessages from "../../data/messages/prototypes/tractor.json" with { type: "json" };
import { TractorContentSchema, type TractorContent } from "./tractor.js";
import refiningData from "../../data/puzzles/refining.json" with { type: "json" };
import refiningMessages from "../../data/messages/prototypes/refining.json" with { type: "json" };
import { RefiningContentSchema, type RefiningContent } from "./refining.js";
import freefallData from "../../data/puzzles/freefall.json" with { type: "json" };
import forgingData from "../../data/puzzles/forging.json" with { type: "json" };
import freefallMessages from "../../data/messages/prototypes/freefall.json" with { type: "json" };
import forgingMessages from "../../data/messages/prototypes/forging.json" with { type: "json" };
import { FreefallContentSchema, type FreefallContent } from "./freefall.js";
import showdownData from "../../data/puzzles/showdown.json" with { type: "json" };
import showdownMessages from "../../data/messages/prototypes/showdown.json" with { type: "json" };
import { ShowdownContentSchema, type ShowdownContent } from "./showdown.js";
import { ForgingContentSchema, type ForgingContent } from "./forging.js";
import assemblyData from "../../data/puzzles/assembly.json" with { type: "json" };
import pactData from "../../data/puzzles/pact.json" with { type: "json" };
import assemblyMessages from "../../data/messages/prototypes/assembly.json" with { type: "json" };
import pactMessages from "../../data/messages/prototypes/pact.json" with { type: "json" };
import { AssemblyContentSchema, type AssemblyContent } from "./assembly.js";
import { PactContentSchema, type PactContent } from "./pact.js";

export * from "./base.js";
export * from "./salvage.js";
export * from "./overload.js";
export * from "./deflectors.js";
export * from "./reactor.js";
export * from "./scanner.js";
export * from "./tug.js";
export * from "./racks.js";
export * from "./cutting.js";
export * from "./tractor.js";
export * from "./refining.js";
export * from "./freefall.js";
export * from "./showdown.js";
export * from "./forging.js";
export * from "./assembly.js";
export * from "./pact.js";

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
  readonly tractor: TractorContent;
  readonly refining: RefiningContent;
  readonly freefall: FreefallContent;
  readonly showdown: ShowdownContent;
  readonly forging: ForgingContent;
  readonly assembly: AssemblyContent;
  readonly pact: PactContent;
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
  tractor: { schema: TractorContentSchema, data: tractorData, messages: tractorMessages },
  refining: { schema: RefiningContentSchema, data: refiningData, messages: refiningMessages },
  freefall: { schema: FreefallContentSchema, data: freefallData, messages: freefallMessages },
  showdown: { schema: ShowdownContentSchema, data: showdownData, messages: showdownMessages },
  forging: { schema: ForgingContentSchema, data: forgingData, messages: forgingMessages },
  assembly: { schema: AssemblyContentSchema, data: assemblyData, messages: assemblyMessages },
  pact: { schema: PactContentSchema, data: pactData, messages: pactMessages },
};
export const PROTOTYPE_PUZZLE_CONTENT_IDS = Object.keys(PROTOTYPE_CONTENT) as PrototypePuzzleContentId[];
