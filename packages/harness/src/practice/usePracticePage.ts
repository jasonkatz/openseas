import { useTicked, type TickedHost, type TickedOptions } from "@openseas/boards";
import { useBench, type BenchApi } from "../bench/useBench.jsx";
import type { HarnessPuzzle } from "../puzzles.js";
import { useShowMarks } from "./PracticeShell.jsx";
import { usePractice, type PracticeApi, type PracticeOptions } from "./usePractice.js";

/** What the shell hands every board: what to draw, whether it takes input, the settings, and the frame mark. A board that neither hints nor counts versions ignores those. */
export interface BoardBasics<S> {
  readonly state: S;
  readonly version: number;
  readonly interactive: boolean;
  readonly showMarks: boolean;
  /** Idle hints: on while a round plays that allows them. */
  readonly hints: boolean;
  onFrame(): void;
}

/** One practice page's round, bench and settings, as its JSX and `PracticeShell` read them. */
export interface PracticePage<S, M, C> {
  readonly puzzle: HarnessPuzzle<S, M, C>;
  /** The round: its phase, the engine's state, and the moves a board's controls apply. */
  readonly api: PracticeApi<S, M, C>;
  readonly bench: BenchApi<S>;
  /** What the board draws: the state under review, else the round's state, advanced to the tick clock for a ticked engine. */
  readonly shown: S;
  readonly playing: boolean;
  readonly showMarks: boolean;
  setShowMarks(on: boolean): void;
  /** The tick a move made now carries (ADR 0015); 0 for an untimed engine. It changes only with the round's tick clock. */
  moveTick(): number;
  readonly board: Omit<BoardBasics<S>, "interactive">;
}

/** The state of an engine whose moves carry ticks. */
type Ticks = { readonly tick: number };

/**
 * Everything a practice page wires the same way: the round's lifecycle, the bench around it, the
 * tick clock for a ticked engine, the mark setting, and which state the board draws. The hooks run
 * in one order on every page and every render; for an untimed engine the tick clock runs off.
 * `onRoundStart` is where a page zeroes the counters it keeps for one round's result card.
 */
export function usePracticePage<S, M, C>(puzzle: HarnessPuzzle<S, M, C>, opts: PracticeOptions<S, M> = {}): PracticePage<S, M, C> {
  const [showMarks, setShowMarks] = useShowMarks();
  const api = usePractice(puzzle, opts);
  const bench = useBench(puzzle, api);
  // The clock runs on the round's own config: a lab round may have changed its last tick.
  const clock = puzzle.ticked?.clock(api.round?.config ?? puzzle.config) ?? null;
  // Only `ticks` makes a ticked entry, and it takes a state that carries its tick.
  const ticked = useTicked(
    api as unknown as TickedHost<S & Ticks, M>,
    puzzle.ticked && clock ? ({ ...clock, advance: puzzle.ticked.advance, wait: puzzle.ticked.wait, waitEveryTicks: puzzle.ticked.waitEveryTicks } as TickedOptions<S & Ticks, M>) : null,
  );
  const shown = bench.reviewState ?? ticked.shown;
  const playing = api.phase === "playing";
  return {
    puzzle,
    api,
    bench,
    shown,
    playing,
    showMarks,
    setShowMarks,
    moveTick: ticked.moveTick,
    board: { state: shown, version: api.version, showMarks, hints: playing && bench.hints, onFrame: api.markRendered },
  };
}
