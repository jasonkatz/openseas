import type { RoundSummary } from "@openseas/protocol";
import type { Scenario } from "../scenario/codec.js";
import type { Change } from "./numbers.js";

/**
 * The rounds finished on a puzzle's studio page (DESIGN.md 3.14, ADR 0068): what the Play panel
 * lists, each with the numbers it was dealt on. They stay in this browser for the session and go
 * nowhere else, except the last few summaries a message to the agent carries (ADR 0042 decision 5).
 */

/** How many rounds the page keeps. */
export const ROUNDS_KEPT = 20;
/** How many of them a message to the agent carries: the summary alone, as before. */
export const ROUNDS_TOLD = 5;

/** The numbers a round was dealt on, as a scenario holds them: what "use these numbers" lays back over the draft. */
export type RoundNumbers = Pick<Scenario, "stage" | "overrides" | "roundSeconds" | "paceSeconds" | "thresholds">;

export interface PlayedRound {
  /** Counts up on the page, so a round keeps its place as older ones fall off. */
  readonly id: number;
  readonly summary: RoundSummary;
  readonly bestCombo: number;
  /** What the round's numbers changed from the content file; empty on the shipped numbers. */
  readonly changes: readonly Change[];
  readonly numbers: RoundNumbers;
}

/** A round as the frame is told of it; the id is the frame's to give. */
export type RoundNote = Omit<PlayedRound, "id">;

export function keepRound(all: readonly PlayedRound[], note: RoundNote): PlayedRound[] {
  const id = (all.at(-1)?.id ?? 0) + 1;
  return [...all, { ...note, id }].slice(-ROUNDS_KEPT);
}

/** The summaries a message to the agent carries, oldest first. */
export function toldRounds(all: readonly PlayedRound[]): RoundSummary[] {
  return all.slice(-ROUNDS_TOLD).map((r) => r.summary);
}

/**
 * How a round's score stands against the one it is measured by: the baseline when one is picked
 * (and is not this round), else the round before it. Null when there is nothing to measure by.
 */
export function scoreDelta(all: readonly PlayedRound[], id: number, baseline: number | null): number | null {
  const at = all.findIndex((r) => r.id === id);
  if (at < 0) return null;
  const base = baseline !== null && baseline !== id ? all.find((r) => r.id === baseline) : at > 0 ? all[at - 1] : undefined;
  return base ? all[at]!.summary.score - base.summary.score : null;
}

/** True when the draft already plays on a round's numbers. */
export function sameNumbers(a: RoundNumbers, b: RoundNumbers): boolean {
  return JSON.stringify(numbersOf(a)) === JSON.stringify(numbersOf(b));
}

export function numbersOf(s: RoundNumbers): RoundNumbers {
  return { stage: s.stage, overrides: s.overrides, roundSeconds: s.roundSeconds, paceSeconds: s.paceSeconds, thresholds: s.thresholds };
}

const KEY = (puzzle: string): string => `openseas.studio.rounds.${puzzle}`;

/** The rounds this tab kept for a puzzle, or none when there are none or they cannot be read. */
export function readRounds(puzzle: string): PlayedRound[] {
  try {
    const raw: unknown = JSON.parse(window.sessionStorage.getItem(KEY(puzzle)) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((r): r is PlayedRound => typeof r === "object" && r !== null && typeof r.id === "number" && typeof r.summary?.score === "number" && Array.isArray(r.changes) && typeof r.numbers === "object" && r.numbers !== null).slice(-ROUNDS_KEPT);
  } catch {
    return [];
  }
}

export function writeRounds(puzzle: string, rounds: readonly PlayedRound[]): void {
  try {
    window.sessionStorage.setItem(KEY(puzzle), JSON.stringify(rounds));
  } catch {
    /* private mode, or full: the list lives as long as the page */
  }
}
