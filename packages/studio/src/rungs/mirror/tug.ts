// Tug on the new engine, shown as the state the prototype's board draws (ADR 0097, ADR 0099). The round is played by
// `@openseas/puzzle`: the bay, every flick and where the pod comes to rest, each clamp and its par, deliveries, skips,
// the points and the streak. This file only turns what that round reports into the old shape, so the board, its
// sounds and its page are the prototype's, unchanged.
import { InvalidMoveError, TUG_DEF, tugSlide, tugStreakPercentAt, type PuzzleDef, type TugClamp, type TugConfig, type TugDelivery, type TugDir, type TugMove, type TugMoveReport, type TugState } from "@openseas/engine";
import { play, read, seedFromString, start, type AnyMove, type Round, type Setting } from "@openseas/puzzle";
import tug, { type Bay } from "@openseas/puzzle/examples/tug";
import { held, roundOf } from "./held.js";

/** The prototype's numbers under the names the new puzzle gives them. A skip's penalty is negative points. */
export function tugSettings(c: TugConfig): Record<string, Setting> {
  return {
    width: c.width, height: c.height, pods: c.pods, blocks: c.blocks, startPar: c.startPar, maxPar: c.maxPar, cleanPerStep: c.cleanPerStep, slack: c.slack,
    parPoints: c.parPoints, cleanPercent: c.cleanPercent, slowPercent: c.slowPercent, streakPercent: c.streakPercent, skipPoints: -c.skipPenalty, maxMoves: c.maxMoves,
  };
}

type Kept = Pick<TugState, "moveCount" | "logLength" | "bestCombo" | "bestPar">;

function shown(round: Round<AnyMove>, config: TugConfig, kept: Kept, lastMove: TugMoveReport | null, ended = false): TugState {
  const now = read(round);
  const bay = (now.state as { bay: Bay }).bay;
  const stat = (id: string): number => (now.stats as Record<string, number>)[id] ?? 0;
  const state: TugState = {
    config,
    blocks: bay.blocks,
    pods: bay.pods,
    clamp: bay.clamp,
    flicks: bay.flicks,
    level: bay.level,
    rng: round.state.streams.bay!,
    score: now.score,
    ...kept,
    delivered: stat("delivered"),
    clean: stat("clean"),
    skipped: stat("skipped"),
    combo: now.streak,
    lastMove,
    finished: ended || kept.logLength >= config.maxMoves,
  };
  return held(state, round);
}

const deal = (seed: string, config: TugConfig): Round<AnyMove> =>
  start(tug, { seed, settings: tugSettings(config), streams: { bay: seedFromString(`tug:${seed}`) } }) as unknown as Round<AnyMove>;

export const TUG_MIRROR: PuzzleDef<TugState, TugMove, TugConfig> = {
  ...TUG_DEF,
  create: (seed, config) => {
    TUG_DEF.validateConfig(config);
    return shown(deal(seed, config), config, { moveCount: 0, logLength: 0, bestCombo: 0, bestPar: 0 }, null);
  },
  reduce: (state, move) => {
    if (state.finished) throw new InvalidMoveError("game is finished", move);
    const round = roundOf(state);
    const c = state.config;
    const kept: Kept = { moveCount: state.moveCount, logLength: state.logLength, bestCombo: state.bestCombo, bestPar: state.bestPar };
    // Ending early is the host's.
    if (move.type === "end") return shown(round, c, kept, null, true);
    const next = play(round, move.type === "flick" ? { move: "flick", pod: move.pod, dir: move.dir } : { move: "skip" });
    if (next.last.refused) throw new InvalidMoveError(next.last.refused, move);
    kept.logLength++;
    const events = next.last.events;
    const points = read(next).score - state.score;
    const lit = events.find((e) => e.event === "clamp");
    const clamp: TugClamp | null = lit ? (read(next).state as { bay: Bay }).bay.clamp : null;
    if (move.type === "skip") return shown(next, c, kept, { move, slide: null, delivered: null, skipped: { clamp: state.clamp, penalty: -points }, clamp, points });
    kept.moveCount++;
    const at = tugSlide(state, move.pod, move.dir as TugDir);
    const slide = { pod: move.pod, from: state.pods[move.pod]!, to: at.to, stop: at.stop };
    const done = events.find((e) => e.event === "clean" || e.event === "late");
    let delivered: TugDelivery | null = null;
    if (done) {
      const grade = done.event === "clean" ? "clean" : done.fields.slow ? "slow" : "full";
      const streak = grade === "clean" ? state.combo + 1 : 0;
      const par = done.fields.par as number;
      delivered = { pod: move.pod, cell: at.to, flicks: done.fields.flicks as number, par, grade, streak, streakPercent: grade === "clean" ? tugStreakPercentAt(c, streak) : 100, points };
      kept.bestCombo = Math.max(kept.bestCombo, streak);
      if (grade === "clean") kept.bestPar = Math.max(kept.bestPar, par);
    }
    return shown(next, c, kept, { move, slide, delivered, skipped: null, clamp, points });
  },
};
