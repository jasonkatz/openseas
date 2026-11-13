import { useEffect, useRef, useState, type ReactNode } from "react";
import { t } from "@openseas/boards";
import { useFrame } from "../frame/RoundFrame.jsx";
import { ThumbShell } from "../home/ThumbShell.jsx";
import { PlayShell } from "../play/PlayShell.jsx";
import { StudioShell } from "../studio/StudioShell.jsx";
import type { PracticeOutcome, PracticePhase } from "./usePractice.js";

const MARKS_KEY = "openseas.markTiles";

export function readMarksFlag(): boolean {
  try {
    return window.localStorage.getItem(MARKS_KEY) === "1";
  } catch {
    return false;
  }
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const onChange = (): void => setMatches(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** Eases a displayed number toward its target so score changes read as a tally, not a jump. */
export function useTally(target: number, ms = 450): number {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (target < shown || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setShown(target);
      return;
    }
    from.current = shown;
    const start = performance.now();
    let id = 0;
    const step = (now: number): void => {
      const k = Math.min(1, (now - start) / ms);
      setShown(Math.round(from.current + (target - from.current) * (1 - (1 - k) ** 3)));
      if (k < 1) id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [target, ms]);
  return shown;
}

/** The "mark tiles" accessibility setting, shared by every board (rule 6). */
export function useShowMarks(): [boolean, (on: boolean) => void] {
  const [showMarks, setShowMarks] = useState(readMarksFlag);
  useEffect(() => {
    try {
      window.localStorage.setItem(MARKS_KEY, showMarks ? "1" : "0");
    } catch {
      /* private mode */
    }
  }, [showMarks]);
  return [showMarks, setShowMarks];
}

export interface ShellProps {
  /** Message-table prefix for this puzzle's strings, e.g. "engines". */
  puzzle: string;
  /** The line over the title on the start card; a prototype says it is one (ADR 0036). Defaults to duty practice. */
  eyebrow?: string;
  phase: PracticePhase;
  outcome: PracticeOutcome | null;
  roundSeconds: number;
  timeLeft: number;
  score: number;
  moves: number;
  /** The move cap for the HUD bar; leave it out for puzzles whose count is not against a cap. */
  maxMoves?: number | undefined;
  /** Label for the moves stat when "Moves" is not the word (e.g. stars landed). */
  movesLabel?: string;
  /** Label for the score stat when "Score" is not the word (e.g. a rate). */
  scoreLabel?: string;
  /** What the live tier indicator adds up, when the score shown is not points over the round (a fight's rate shows as the score). */
  pacePoints?: number;
  /** Reads a stretch of play as a score for the indicator, where the round's length does not (an engine function). */
  paceProject?: (points: number, seconds: number) => number;
  /** Leads the result card, above the score: what decided the round, where that matters most (a fight won or lost). */
  resultHeadline?: ReactNode;
  combo: number;
  /** Start a round on the frame's numbers (studio/useStudio). A seed given here is dealt once and pins nothing. */
  onStart(seed?: string): void;
  /** False while the current build refuses the draft's numbers. */
  ready: boolean;
  /** Art or extra lines on the start card above the how-to. */
  art?: ReactNode;
  /** Extra lines on the start card under the how-to. */
  howTo?: ReactNode;
  /** Stats shown in the details sheet beside the combo meter. */
  details?: ReactNode;
  /** The piece legend and settings, shown in the details sheet. */
  legend: ReactNode;
  /** Extra rows on the result card. */
  resultRows?: ReactNode;
  /** True while the board is in a dangerous state; colors the details button. */
  warn?: boolean;
  /** The board. `interactive` is false when a sheet covers it or no round is running. */
  board(interactive: boolean): ReactNode;
  /** Big text splashed over the board when a round starts. */
  splash: string;
}

/**
 * The frame every puzzle's page draws itself in. Which one depends on how the page was opened
 * (frame/RoundFrame): the studio, with the tuning panel beside the board, or the puzzle alone.
 */
export function PracticeShell(p: ShellProps) {
  const mode = useFrame().mode;
  return mode === "studio" ? <StudioShell {...p} /> : mode === "thumb" ? <ThumbShell {...p} /> : <PlayShell {...p} />;
}

export function ResultScore({ score }: { score: number }) {
  const [target, setTarget] = useState(0);
  useEffect(() => setTarget(score), [score]);
  const shown = useTally(target, 900);
  return (
    <p className="result-score" data-testid="result-score">
      {shown}
    </p>
  );
}

/** The marks toggle every legend ends with. */
export function MarksToggle({ showMarks, onChange }: { showMarks: boolean; onChange(on: boolean): void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={showMarks} onChange={(e) => onChange(e.target.checked)} data-testid="toggle-marks" />
      <span>
        {t("practice.setting_marks")} <small className="muted">{t("practice.setting_marks_hint")}</small>
      </span>
    </label>
  );
}

