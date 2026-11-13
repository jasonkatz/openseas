import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { HarnessPuzzle } from "../puzzles.js";
import { formatScenario, parseScenario, type Scenario } from "../scenario/codec.js";
import { changes, refusals, shippedNumbers, tunedNumbers, withNumber, withoutNumber, withoutNumbers, type Change, type Numbers, type Refusal } from "./numbers.js";

/**
 * How a puzzle's page is framed. `studio` is the owner's page: the board with the tuning panel
 * beside it (DESIGN.md 3.14). `play` is the puzzle alone, full-screen: what a tester opens at
 * `/play/<puzzle>` (ADR 0042 decision 11), and all a phone gets.
 */
export type FrameMode = "studio" | "play" | "thumb";

/** What the page says back about the round in play or last played, for the shell around it. */
export interface RoundReport {
  /** The seed it was dealt from. */
  readonly seed: string | null;
  /** True when replaying the finished round's log from its seed did not give the hashes the round made (ADR 0042 decision 3). */
  readonly replayMismatch: boolean;
}

const NO_ROUND: RoundReport = { seed: null, replayMismatch: false };

export interface Frame {
  readonly mode: FrameMode;
  readonly puzzle: HarnessPuzzle<unknown, unknown, unknown>;
  /** What the address bar says: the seed, the numbers laid over content, and how the round's clock starts. */
  readonly scenario: Scenario;
  /** Changes the scenario and keeps the address bar in step, so the page is always one link. */
  setScenario(next: Scenario): void;
  /** The content file's numbers. */
  readonly shipped: Numbers<unknown>;
  /** Content with the scenario's numbers laid over it: the draft. */
  readonly tuned: Numbers<unknown>;
  /** What a round started now is dealt on: the draft, or the shipped numbers while they are being compared. */
  readonly numbers: Numbers<unknown>;
  /** Why the current build will not play the draft. Empty when it will. */
  readonly refusals: readonly Refusal[];
  /** What the draft changes from the content file. */
  readonly changes: readonly Change[];
  /** Set one number by its key in the content file; its shipped value puts it back. */
  setNumber(key: string, value: unknown): void;
  resetNumber(key: string): void;
  resetNumbers(): void;
  /** True while the shipped numbers stand in for the draft, so the same seed can be seen both ways. */
  readonly comparing: boolean;
  setComparing(on: boolean): void;
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
 * Stands around a puzzle's page and owns its draft: the numbers the address bar lays over
 * content, whether the current build will play them, and what they change. The tuning panel
 * writes it, the page inside reads it (studio/useStudio) and reports its round back, and the
 * shell rates the round against the draft's own thresholds.
 */
export function RoundFrame({ mode, puzzle, children }: { mode: FrameMode; puzzle: HarnessPuzzle<unknown, unknown, unknown>; children: ReactNode }) {
  const [scenario, setScenarioState] = useState<Scenario>(() => parseScenario(window.location.search));
  const [report, setReportState] = useState<RoundReport>(NO_ROUND);
  const [comparing, setComparing] = useState(false);

  const setScenario = useCallback((next: Scenario) => {
    setScenarioState(next);
    const qs = formatScenario({ ...next, autostart: null });
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, []);
  const setReport = useCallback((next: RoundReport) => {
    setReportState((prev) => (prev.seed === next.seed && prev.replayMismatch === next.replayMismatch ? prev : next));
  }, []);
  const setNumber = useCallback((key: string, value: unknown) => setScenario(withNumber(puzzle, scenario, key, value)), [puzzle, scenario, setScenario]);
  const resetNumber = useCallback((key: string) => setScenario(withoutNumber(puzzle, scenario, key)), [puzzle, scenario, setScenario]);
  const resetNumbers = useCallback(() => setScenario(withoutNumbers(scenario)), [scenario, setScenario]);

  const shipped = useMemo(() => shippedNumbers(puzzle), [puzzle]);
  // Only what makes the numbers: a new seed alone must not hand the page a new config to redraw.
  const tuned = useMemo(
    () => tunedNumbers(puzzle, scenario),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [puzzle, scenario.overrides, scenario.roundSeconds, scenario.paceSeconds, scenario.thresholds],
  );
  const refused = useMemo(() => refusals(puzzle, tuned), [puzzle, tuned]);
  const changed = useMemo(() => (refused.length ? [] : changes(puzzle, tuned)), [puzzle, tuned, refused]);
  const numbers = comparing ? shipped : tuned;
  const value = useMemo<Frame>(
    () => ({ mode, puzzle, scenario, setScenario, shipped, tuned, numbers, refusals: refused, changes: changed, setNumber, resetNumber, resetNumbers, comparing, setComparing, report, setReport }),
    [mode, puzzle, scenario, setScenario, shipped, tuned, numbers, refused, changed, setNumber, resetNumber, resetNumbers, comparing, report, setReport],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
