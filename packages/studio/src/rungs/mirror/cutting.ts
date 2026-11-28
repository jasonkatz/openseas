// Cutting on the new engine, shown as the state the prototype's board draws (ADR 0097, ADR 0099). The round is
// played by `@openseas/puzzle`: every slab dealt and its cuts, every cut and the pieces it banks, the grade, its
// bonus and the streak. This file only turns what that round reports into the old shape, so the board, its sounds
// and its page are the prototype's, unchanged.
import { CUTTING_DEF, cuttingStreakPercentAt, InvalidMoveError, type CuttingBanked, type CuttingConfig, type CuttingGrade, type CuttingHalf, type CuttingMove, type CuttingMoveReport, type CuttingSlabReport, type CuttingState, type PuzzleDef } from "@openseas/engine";
import { play, read, seedFromString, start, type AnyMove, type Round, type Setting } from "@openseas/puzzle";
import cutting, { split, type Slab } from "@openseas/puzzle/examples/cutting";
import { held, roundOf } from "./held.js";

/** The prototype's numbers under the names the new puzzle gives them. */
export function cuttingSettings(c: CuttingConfig): Record<string, Setting> {
  return {
    width: c.width, height: c.height, ores: c.ores, partsLeast: c.partsStart, partsMost: c.partsMax, flawsLeast: c.flawsStart, flawsMost: c.flawsMax, growEvery: c.growEvery,
    maxBlockPercent: c.maxBlockPercent, budgetPercent: c.budgetPercent, minCuts: c.minCuts, maxCuts: c.maxCuts, cleanPercent: c.cleanPercent, cellPoints: c.cellPoints,
    cleanPoints: c.cleanBonus, flawlessPoints: c.flawlessBonus, streakPercent: c.streakPercent, maxMoves: c.maxMoves,
  };
}

const slabOf = (round: Round<AnyMove>): Slab => (read(round).state as { slab: Slab }).slab;
const cutsDealt = (round: Round<AnyMove>): number => round.last.events.filter((e) => e.event === "slab").at(-1)!.fields.cuts as number;

/** Everything the board keeps that the round does not: what this slab banked, and the round's tallies. */
type Kept = { -readonly [K in keyof Pick<CuttingState, "banked" | "cutsAllowed" | "moveCount" | "logLength" | "bestCombo" | "slabsDone" | "flawless" | "clean" | "rough" | "totalGot" | "totalBest" | "biggest">]: CuttingState[K] };

function shown(round: Round<AnyMove>, config: CuttingConfig, kept: Kept, lastMove: CuttingMoveReport | null, ended = false): CuttingState {
  const now = read(round);
  const slab = slabOf(round);
  const state: CuttingState = {
    config,
    ores: slab.ores,
    pieces: slab.pieces,
    slab: slab.slab,
    cutsLeft: slab.cutsLeft,
    slabGot: slab.got,
    slabBest: slab.best,
    rng: round.state.streams.slab!,
    nextId: slab.nextId,
    score: now.score,
    combo: now.streak,
    ...kept,
    lastMove,
    finished: ended || kept.logLength >= config.maxMoves,
  };
  return held(state, round);
}

const deal = (seed: string, config: CuttingConfig): Round<AnyMove> =>
  start(cutting, { seed, settings: cuttingSettings(config), streams: { slab: seedFromString(`cutting:${seed}`) } }) as unknown as Round<AnyMove>;

export const CUTTING_MIRROR: PuzzleDef<CuttingState, CuttingMove, CuttingConfig> = {
  ...CUTTING_DEF,
  create: (seed, config) => {
    CUTTING_DEF.validateConfig(config);
    const round = deal(seed, config);
    return shown(round, config, { banked: [], cutsAllowed: cutsDealt(round), moveCount: 0, logLength: 0, bestCombo: 0, slabsDone: 0, flawless: 0, clean: 0, rough: 0, totalGot: 0, totalBest: 0, biggest: 0 }, null);
  },
  reduce: (state, move) => {
    if (state.finished) throw new InvalidMoveError("game is finished", move);
    const round = roundOf(state);
    const c = state.config;
    const kept: Kept = { banked: state.banked, cutsAllowed: state.cutsAllowed, moveCount: state.moveCount, logLength: state.logLength + 1, bestCombo: state.bestCombo, slabsDone: state.slabsDone, flawless: state.flawless, clean: state.clean, rough: state.rough, totalGot: state.totalGot, totalBest: state.totalBest, biggest: state.biggest };
    // Ending early is the host's.
    if (move.type === "end") return shown(round, c, kept, null, true);
    const next = play(round, move.type === "cut" ? { move: "cut", piece: move.piece, vertical: move.vertical, at: move.at } : { move: "done" });
    if (next.last.refused) throw new InvalidMoveError(next.last.refused, move);
    const events = next.last.events;

    // The cut: its two halves, each named as the slab names them, and banked when it is all one ore.
    let cut: CuttingMoveReport["cut"] = null;
    let [banked, got, pieces, cutsLeft, cutPoints] = [state.banked, state.slabGot, state.pieces, state.cutsLeft, 0];
    if (move.type === "cut") {
      const piece = state.pieces.find((p) => p.id === move.piece)!;
      const pure = events.filter((e) => e.event === "bank");
      const halves = split(piece, move.vertical, move.at).map((r, i): CuttingHalf => {
        const first = state.ores[r.y * c.width + r.x]!;
        const isPure = Array.from({ length: r.w * r.h }, (_, k) => state.ores[(r.y + Math.floor(k / r.w)) * c.width + r.x + (k % r.w)]).every((o) => o === first);
        return { piece: { id: state.nextId + i, ...r }, ore: isPure ? first : null, points: isPure ? c.cellPoints * r.w * r.h * r.w * r.h : 0 };
      }) as [CuttingHalf, CuttingHalf];
      if (pure.length !== halves.filter((h) => h.ore !== null).length) throw new Error("the round banked other pieces than the cut made");
      cut = { piece, vertical: move.vertical, at: move.at, halves };
      cutPoints = halves[0].points + halves[1].points;
      banked = [...banked, ...halves.flatMap((h): CuttingBanked[] => (h.ore === null ? [] : [{ ...h.piece, ore: h.ore, points: h.points }]))];
      pieces = [...pieces.filter((p) => p.id !== piece.id), ...halves.flatMap((h) => (h.ore === null ? [h.piece] : []))];
      got += cutPoints;
      cutsLeft--;
      kept.moveCount++;
      kept.biggest = Math.max(kept.biggest, ...halves.map((h) => (h.ore === null ? 0 : h.piece.w * h.piece.h)));
    }

    // The slab, when this move ended it: its grade and bonus, and the next one dealt.
    const graded = events.find((e) => e.event === "flawless" || e.event === "clean" || e.event === "rough");
    let slab: CuttingSlabReport | null = null;
    if (graded) {
      const grade = graded.event as CuttingGrade;
      const streak = grade === "rough" ? 0 : state.combo + 1;
      const percent = cuttingStreakPercentAt(c, streak);
      const base = grade === "flawless" ? c.flawlessBonus : grade === "clean" ? c.cleanBonus : 0;
      const reason = move.type === "done" ? "done" : pieces.length === 0 ? "clear" : cutsLeft === 0 ? "cuts" : "stuck";
      slab = { reason, got, best: state.slabBest, grade, bonus: Math.floor((base * percent) / 100), streak, streakPercent: percent, scrap: pieces, cutsLeft };
      Object.assign(kept, {
        banked: [], cutsAllowed: cutsDealt(next), bestCombo: Math.max(kept.bestCombo, streak), slabsDone: kept.slabsDone + 1,
        flawless: kept.flawless + (grade === "flawless" ? 1 : 0), clean: kept.clean + (grade === "clean" ? 1 : 0), rough: kept.rough + (grade === "rough" ? 1 : 0),
        totalGot: kept.totalGot + got, totalBest: kept.totalBest + state.slabBest,
      });
    } else kept.banked = banked;
    return shown(next, c, kept, { move, cut, slab, points: read(next).score - state.score });
  },
};
