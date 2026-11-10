import type { PuzzleDef } from "../def.js";
import { createScannerGame, hashScannerState, reduceScanner, summarizeScanner, validateConfig } from "./reduce.js";
import { DEFAULT_SCANNER_CONFIG, type ScannerConfig, type ScannerMove, type ScannerState } from "./types.js";

export * from "./types.js";
export {
  createScannerGame,
  reduceScanner,
  replayScanner,
  hashScannerState,
  summarizeScanner,
  validateConfig as validateScannerConfig,
  distance as scannerDistance,
  contactsFor as scannerContactsFor,
  parFor as scannerParFor,
  streakPercentAt as scannerStreakPercentAt,
  lockValue as scannerLockValue,
  saveValue as scannerSaveValue,
  pingsLeft as scannerPingsLeft,
  contactsLeft as scannerContactsLeft,
  knownContacts as scannerKnownContacts,
  pingAt as scannerPingAt,
  ringCells as scannerRingCells,
  clearCells as scannerClearCells,
  pingCandidates as scannerPingCandidates,
  provenCells as scannerProvenCells,
  safePing as scannerSafePing,
  hint as scannerHint,
  plainlySolvable as scannerPlainlySolvable,
  pingIllegalReason as scannerPingIllegalReason,
  lockIllegalReason as scannerLockIllegalReason,
  viewString as scannerViewString,
  idx as scannerIdx,
  colOf as scannerColOf,
  rowOf as scannerRowOf,
  type ScannerHint,
  type ScannerSummary,
} from "./reduce.js";

export const SCANNER_DEF: PuzzleDef<ScannerState, ScannerMove, ScannerConfig> = {
  id: "scanner",
  defaultConfig: DEFAULT_SCANNER_CONFIG,
  validateConfig,
  create: createScannerGame,
  reduce: reduceScanner,
  hash: hashScannerState,
  summarize: summarizeScanner,
  isFinished: (s) => s.finished,
  maxMoves: (c) => c.maxMoves + 1,
};
