import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { HarnessPuzzle } from "../puzzles.js";
import { formatScenario, parseScenario, type Scenario } from "../scenario/codec.js";
import { changes, refusals, tunedNumbers, type Change, type Numbers, type Refusal } from "./numbers.js";

/**
 * How a puzzle's page is framed. `bench` is the practice page with the bench around it, as ADR
 * 0019 built it. `play` is the puzzle alone, full-screen, with nothing asked of a server: what a
 * tester opens at `/play/<puzzle>` (ADR 0042 decision 11).
 */
export type FrameMode = "bench" | "play";

/** What the page says back about the round in play or last played, for the shell around it. */
export interface RoundReport {
  /** The seed it was dealt from. */
  readonly seed: string | null;
  /** True when the round is on the frame's numbers and not on what the game deals. */
  readonly tuned: boolean;
  /** True when replaying the finished round's log from its seed did not give the hashes the round made (ADR 0042 decision 3). */
  readonly replayMismatch: boolean;
}

const NO_ROUND: RoundReport = { seed: null, tuned: false, replayMismatch: false };

export interface Frame {
  readonly mode: FrameMode;
  readonly puzzle: HarnessPuzzle<unknown, unknown, unknown>;
  /** What the address bar asked for: the seed, the numbers laid over content, and how the round's clock starts. */
  readonly scenario: Scenario;
  /** Changes the scenario and keeps the address bar in step, so the page is always one link. */
  setScenario(next: Scenario): void;
  /** The numbers a tuned round here is played on: content with the scenario's laid over it. */
  readonly numbers: Numbers<unknown>;
  /** Why the current build will not play those numbers. Empty when it will. */
  readonly refusals: readonly Refusal[];
  /** What differs from the content file. */
  readonly changes: readonly Change[];
  readonly report: RoundReport;
  setReport(report: RoundReport): void;
}

const Ctx = createContext<Frame | null>(null);

export function useFrame(): Frame {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFrame outside RoundFrame");
  return v;
}

/**
 * Stands around a puzzle's page and owns what the address bar says about its round: the scenario,
 * the numbers it makes, and whether the current build will play them. The page inside reads it
 * (bench/useBench) and reports its round back, so the shell can rate a tuned round against the
 * tuned thresholds and say when a replay disagreed.
 */
export function RoundFrame({ mode, puzzle, children }: { mode: FrameMode; puzzle: HarnessPuzzle<unknown, unknown, unknown>; children: ReactNode }) {
  const [scenario, setScenarioState] = useState<Scenario>(() => parseScenario(window.location.search));
  const [report, setReportState] = useState<RoundReport>(NO_ROUND);

  const setScenario = useCallback((next: Scenario) => {
    setScenarioState(next);
    const qs = formatScenario({ ...next, autostart: null, review: false });
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, []);
  const setReport = useCallback((next: RoundReport) => {
    setReportState((prev) => (prev.seed === next.seed && prev.tuned === next.tuned && prev.replayMismatch === next.replayMismatch ? prev : next));
  }, []);

  // Only what makes the numbers: a new seed alone must not hand the page a new config to redraw.
  const numbers = useMemo(
    () => tunedNumbers(puzzle, scenario),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [puzzle, scenario.overrides, scenario.roundSeconds, scenario.paceSeconds, scenario.thresholds],
  );
  const refused = useMemo(() => refusals(puzzle, numbers), [puzzle, numbers]);
  const changed = useMemo(() => (refused.length ? [] : changes(puzzle, numbers)), [puzzle, numbers, refused]);
  const value = useMemo<Frame>(
    () => ({ mode, puzzle, scenario, setScenario, numbers, refusals: refused, changes: changed, report, setReport }),
    [mode, puzzle, scenario, setScenario, numbers, refused, changed, report, setReport],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
