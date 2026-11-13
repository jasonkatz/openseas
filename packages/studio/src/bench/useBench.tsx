import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { t } from "@openseas/boards";
import { useFrame } from "../frame/RoundFrame.jsx";
import { localSeed, type PracticeApi } from "../practice/usePractice.js";
import type { HarnessPuzzle } from "../puzzles.js";
import { replayAgrees, replayRound, type Replay } from "../review/replay.js";
import { takeStashedRoundFile, type RoundFile } from "../review/roundFile.js";
import type { Scenario } from "../scenario/codec.js";
import { validateConfig, type Validation } from "../scenario/validate.js";
import { ClockPanel } from "./ClockPanel.jsx";
import { copyText } from "./format.js";
import { ImportPanel } from "./ImportPanel.jsx";
import { InspectorPanel } from "./InspectorPanel.jsx";
import { ReviewBar } from "./ReviewBar.jsx";
import { ScenarioPanel } from "./ScenarioPanel.jsx";

export interface Review<S, M> {
  readonly round: RoundFile;
  readonly replay: Replay<S, M>;
  readonly index: number;
  /** Bumps when the board must be redrawn from scratch (a step back or a jump), not animated forward. */
  readonly remount: number;
}

export interface BenchApi<S> {
  /** The bench panels, for the shell's sidebar or sheet. None on a `/play` page. */
  bench: ReactNode | undefined;
  /** Set while a log is being reviewed; the shell hides the start card and shows this strip. */
  reviewBar: ReactNode | undefined;
  /** The state to draw instead of the live one while reviewing. */
  reviewState: S | null;
  /** Changes when the board should be remounted during review. */
  reviewKey: string | null;
  /** Start a round on the frame's numbers. With no seed given: the scenario's, or a fresh one when it pins none. */
  startLab(seed?: string): void;
  labReady: boolean;
  labSummary: ReactNode;
  /** Idle hints for the round in play: on for unrated and (unless turned off) lab rounds, never for recorded. */
  hints: boolean;
  scenario: Scenario;
}

/**
 * A round's clock, reachable from a script and from nowhere on screen. The guides' capture holds
 * a round still and steps it a tick at a time so each frame lands where it is planned (ADR 0038);
 * the studio has no control for that any more (ADR 0042), so the capture drives this.
 */
export interface RoundClockHandle {
  pause(): void;
  resume(): void;
  /** Advance a held clock by this many milliseconds; one tick of a ticked puzzle when left out, else a second. */
  step(ms?: number): void;
  readonly paused: boolean;
  /** The tick a ticked puzzle's round is on; null for the others. */
  readonly tick: number | null;
}
declare global {
  interface Window {
    openseasRoundClock?: RoundClockHandle;
  }
}

/**
 * What stands between a puzzle's page and the frame around it (frame/RoundFrame): the round on
 * the frame's numbers (seed, config, length, thresholds), the replay check after every round, and
 * on a bench page the bench's own tools: the scenario form, the inspector, importing and reviewing
 * logs. Everything recorded and unrated rounds do is untouched; the bench only reads them.
 */
export function useBench<S, M, C>(puzzle: HarnessPuzzle<S, M, C>, api: PracticeApi<S, M, C>): BenchApi<S> {
  const frame = useFrame();
  const { scenario, setScenario, numbers, setReport } = frame;
  const play = frame.mode === "play";
  const [review, setReview] = useState<Review<S, M> | null>(null);
  const started = useRef(false);
  const labConfig = numbers.config as C;
  const validation = useMemo<Validation>(
    () => ({ ok: frame.refusals.length === 0, errors: frame.refusals.map((r) => `${r.key}: ${r.message}`), issues: [] }),
    [frame.refusals],
  );
  const playing = api.phase === "playing" || api.phase === "starting" || api.phase === "waiting";

  // The board behind the start card shows the scenario: its seed and config. Only the stable parts
  // of the api are dependencies; the api object itself is rebuilt every render and would loop.
  const { phase, preview } = api;
  useEffect(() => {
    if (phase !== "idle" || review) return;
    if (validation.ok) preview(scenario.seed ?? "menu", labConfig);
  }, [phase, preview, review, scenario.seed, labConfig, validation.ok]);

  const exitReview = useCallback(() => {
    setReview(null);
    api.reset(scenario.seed ?? "menu", validation.ok ? labConfig : undefined);
  }, [api, scenario.seed, labConfig, validation.ok]);

  const openReview = useCallback(
    (round: RoundFile, at?: number): string | null => {
      const config = (round.config ?? puzzle.config) as C;
      const check = validateConfig(puzzle, config);
      if (!check.ok) return check.errors.join("; ");
      let replay: Replay<S, M>;
      try {
        replay = replayRound(puzzle.def, round.seed, config, round.moves as readonly M[], round.hashes);
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
      api.reset(round.seed, config);
      const index = at ?? replay.divergedAt ?? replay.error?.atSeq ?? replay.steps.length;
      setReview({ round, replay, index: Math.max(0, Math.min(replay.steps.length, index)), remount: 1 });
      return null;
    },
    [api, puzzle],
  );

  const setReviewIndex = useCallback((index: number) => {
    setReview((r) => {
      if (!r) return r;
      const next = Math.max(0, Math.min(r.replay.steps.length, index));
      if (next === r.index) return r;
      // One step forward animates the move; anything else redraws the board from the state.
      return { ...r, index: next, remount: next === r.index + 1 ? r.remount : r.remount + 1 };
    });
  }, []);

  const startLab = useCallback(
    (seed?: string) => {
      if (!validation.ok) return;
      setReview(null);
      api.startLab({
        seed: seed ?? scenario.seed ?? localSeed(),
        config: labConfig,
        roundSeconds: numbers.roundSeconds,
        thresholds: numbers.thresholds,
        speed: scenario.speed,
        paused: scenario.paused,
      });
    },
    [api, labConfig, numbers, scenario, validation.ok],
  );

  // A page opened with ?start= or ?review= gets going on its own.
  useEffect(() => {
    if (started.current) return;
    if (scenario.review) {
      started.current = true;
      const stashed = takeStashedRoundFile(puzzle.id);
      if (stashed) openReview(stashed);
      setScenario({ ...scenario, review: false });
      return;
    }
    // A `/play` page has one kind of round, so any `start` starts it.
    if (scenario.autostart === "lab" || (play && scenario.autostart)) {
      started.current = true;
      startLab();
    } else if (scenario.autostart === "unrated") {
      started.current = true;
      api.startUnrated();
    } else if (scenario.autostart === "recorded") {
      if (!api.canRecord) return;
      started.current = true;
      api.startRecorded();
    } else started.current = true;
    if (scenario.autostart) setScenario({ ...scenario, autostart: null });
  }, [api, openReview, play, puzzle.id, scenario, setScenario, startLab]);

  // Replay the finished round from its seed and compare every hash: the determinism check.
  const check = useMemo((): Replay<S, M> | null => {
    if (api.phase !== "result" && api.phase !== "waiting") return null;
    const round = api.round;
    if (!round || api.log.length === 0) return null;
    return replayRound(
      puzzle.def,
      round.seed,
      round.config,
      api.log.map((m) => m.move),
      api.log.map((m) => m.hash),
    );
    // api.log is a live array; api.version changes whenever it grows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api.phase, api.round, api.version, puzzle.def]);

  // The shell around the page hears which round this is and whether its replay disagreed.
  const roundSeed = api.phase === "idle" ? null : (api.round?.seed ?? null);
  const tuned = api.phase !== "idle" && api.round?.mode === "lab";
  const replayMismatch = check !== null && !replayAgrees(check);
  useEffect(() => setReport({ seed: roundSeed, tuned, replayMismatch }), [setReport, roundSeed, tuned, replayMismatch]);

  // The round's clock, for a script (see RoundClockHandle). Only a lab round has one to hold.
  const clock = api.clock;
  const tickMs = puzzle.ticked?.tickMs ?? null;
  useEffect(() => {
    if (!clock) return;
    const startedAt = api.current()?.opts.startedAt ?? clock.now();
    const handle: RoundClockHandle = {
      pause: () => clock.pause(),
      resume: () => clock.resume(),
      step: (ms) => clock.step(ms ?? tickMs ?? 1000),
      get paused() {
        return clock.isPaused;
      },
      get tick() {
        return tickMs ? Math.max(0, Math.floor(Math.max(0, clock.now() - startedAt) / tickMs) - 1) : null;
      },
    };
    window.openseasRoundClock = handle;
    return () => {
      if (window.openseasRoundClock === handle) delete window.openseasRoundClock;
    };
    // api.current is stable; the round it reads changes with the clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock, tickMs]);

  const roundFile = useCallback((): RoundFile | null => {
    const round = api.round;
    if (!round) return null;
    const summary = puzzle.def.summarize(api.state);
    return {
      kind: "openseas.round",
      version: 1,
      puzzle: puzzle.id,
      seed: round.seed,
      config: round.config,
      roundSeconds: round.roundSeconds,
      mode: round.mode,
      sessionId: round.sessionId,
      moves: api.log.map((m) => m.move),
      hashes: api.log.map((m) => m.hash),
      summary,
      exportedAt: new Date().toISOString(),
      harnessCommit: __HARNESS_COMMIT__,
    };
  }, [api.round, api.state, api.log, puzzle]);

  const reviewState = review ? (review.index === 0 ? review.replay.initial : review.replay.steps[review.index - 1]!.state) : null;
  const shown = reviewState ?? api.state;
  const shownHash = review ? (review.index === 0 ? review.replay.initialHash : review.replay.steps[review.index - 1]!.hash) : puzzle.def.hash(api.state);
  const overrideCount = Object.keys(scenario.overrides).length;
  const labSummary: ReactNode = !validation.ok
    ? t("harness.lab_invalid")
    : `${scenario.seed ? t("harness.lab_seed", { seed: scenario.seed }) : t("harness.lab_random_seed")} · ${overrideCount ? t("harness.lab_overrides", { count: overrideCount }) : t("harness.lab_no_overrides")} · ${numbers.roundSeconds}s${scenario.speed !== 1 ? ` · ${t("harness.speed_label", { rate: scenario.speed })}` : ""}`;

  const bench = play ? undefined : (
    <div className="bench-body">
      <ScenarioPanel puzzle={puzzle} scenario={scenario} labConfig={labConfig} validation={validation} locked={playing} onChange={setScenario} onStart={() => startLab()} />
      <ClockPanel clock={api.clock} startedAt={api.current()?.opts.startedAt ?? null} tickMs={puzzle.ticked?.tickMs ?? null} playing={api.phase === "playing"} />
      <InspectorPanel
        puzzle={puzzle}
        api={api}
        shown={shown}
        shownHash={shownHash}
        check={check}
        onExport={() => {
          const f = roundFile();
          if (f) void copyText(JSON.stringify(f, null, 2));
        }}
        onReview={() => {
          const f = roundFile();
          if (f) openReview(f);
        }}
        onReviewAt={(index) => {
          if (review) setReviewIndex(index);
          else {
            const f = roundFile();
            if (f) openReview(f, index);
          }
        }}
        onStop={api.stop}
        onClear={exitReview}
      />
      <ImportPanel puzzle={puzzle.id} disabled={playing} onLoad={(round) => openReview(round)} />
    </div>
  );

  const reviewBar = review ? <ReviewBar replay={review.replay} index={review.index} onIndex={setReviewIndex} onExit={exitReview} /> : undefined;
  const mode = api.round?.mode;
  const hints = mode === "recorded" ? false : mode === "lab" ? scenario.hints : true;

  return {
    bench,
    reviewBar,
    reviewState,
    reviewKey: review ? `review-${review.remount}` : null,
    startLab,
    labReady: validation.ok,
    labSummary,
    hints,
    scenario,
  };
}
