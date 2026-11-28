// Cooling on the new engine, shown as the state the shipped Cooling board draws (ADR 0097). The round is
// played by `@openseas/puzzle`: the deal, every swap, the cascade, the points, the streak and the heat. This
// file only turns what that round reports into the old shape, so the board, its sounds and its page are the
// shipped ones, unchanged.
import { COOLING_DEF, InvalidMoveError, Special, type ClearedGroup, type ClearRound, type CoolingConfig, type CoolingMove, type CoolingState, type Piece as OldPiece, type PuzzleDef } from "@openseas/engine";
import { play, read, seenAfter, start, type AnyMove, type Cell, type Event, type Piece, type Round, type Seen, type Setting } from "@openseas/puzzle";
import cooling from "@openseas/puzzle/examples/cooling";
import { held, roundOf } from "./held.js";

const SPECIALS: Record<string, number> = { charge: Special.Charge, magnet: Special.Magnet, slag: Special.Slag };
const CAUSES: Record<string, ClearedGroup["cause"]> = { clear: "match", scrap: "match", burst: "charge", wipe: "magnet", lift: "slag" };

/** The shipped numbers as the new puzzle's settings. A streak that adds a step a move, up to a cap, is a table of percents. */
export function coolingSettings(c: CoolingConfig): Record<string, Setting> {
  const streak: number[] = [];
  for (let n = 0; streak.at(-1) !== c.streakMaxPercent && n < 64; n++) streak.push(Math.min(c.streakMaxPercent, 100 + n * c.streakStepPercent));
  return {
    width: c.width,
    height: c.height,
    kinds: c.pieceKinds,
    maxMoves: c.maxMoves,
    chargePermille: c.specialChancePerMille.charge,
    magnetPermille: c.specialChancePerMille.magnet,
    slagPermille: c.specialChancePerMille.slag,
    heatStartRow: c.initialHeatRow,
    heatLeastRow: c.minHeatRow,
    heatRiseMoves: c.heatRisePerMoves,
    heatFallPoints: c.heatDropPerPoints,
    streakGrace: c.streakGrace,
    cascadePercent: c.cascadeMultipliers.map((m) => m * 100),
    streakPercent: streak,
  };
}

const ORDER: Record<ClearedGroup["cause"], number> = { charge: 0, magnet: 1, match: 2, slag: 3 };

const old = (p: Piece): OldPiece => ({ id: p.id, kind: p.piece === "kind" ? p.kind! - 1 : SPECIALS[p.piece]! });
/** A board as the shipped engine lists it: row 0 at the bottom. */
const cellsOf = (board: Seen, c: CoolingConfig): OldPiece[] => Array.from({ length: c.width * c.height }, (_, i) => old(board[c.height - 1 - Math.floor(i / c.width)]![i % c.width]!));
const indexOf = (p: Cell, c: CoolingConfig): number => (c.height - 1 - p.y) * c.width + p.x;

/** A move's events as the steps the board plays back: what cleared in each, and the board once it had settled. */
function roundsOf(before: Seen, events: readonly Event[], c: CoolingConfig): ClearRound[] {
  const rounds: ClearRound[] = [];
  let board = before;
  const step: { open: { chain: number; groups: ClearedGroup[]; points: number } | null } = { open: null };
  const close = (): void => {
    // The board plays a step's groups in the order the shipped engine lists them: what the swapped specials took, then runs from the bottom up.
    step.open?.groups.sort((p, q) => ORDER[p.cause] - ORDER[q.cause] || (ORDER[p.cause] < 2 ? 0 : p.cells[0]! - q.cells[0]!));
    if (step.open) rounds.push({ ...step.open, settled: cellsOf(board, c) });
    step.open = null;
  };
  for (const e of events) {
    if (e.step !== undefined) {
      if (step.open?.chain !== e.step) {
        close();
        step.open = { chain: e.step, groups: [], points: 0 };
      }
      const places = [...((e.fields.pieces as readonly Cell[] | undefined) ?? [e.fields.at as Cell])].sort((p, q) => indexOf(p, c) - indexOf(q, c));
      const cause = CAUSES[e.event]!;
      // What the group is worth before anything multiplies it: the step's place in the cascade, and how many cleared together.
      const cascade = cause === "slag" ? 1 : c.cascadeMultipliers[Math.min(e.step, c.cascadeMultipliers.length) - 1]!;
      const points = Math.round((e.points ?? 0) / (((e.fields.together as number | undefined) ?? 1) * cascade));
      step.open.groups.push({ cells: places.map((p) => indexOf(p, c)), ids: places.map((p) => board[p.y]![p.x]!.id), points, cause });
      step.open.points += e.points ?? 0;
    }
    board = seenAfter(board, e);
  }
  close();
  return rounds;
}

/** A round of the new engine as the state the shipped board draws. Its moves go through `COOLING_MIRROR.reduce`. */
export function coolingShown(round: Round<AnyMove>, config: CoolingConfig): CoolingState {
  return shown(round, config, null);
}

function shown(round: Round<AnyMove>, config: CoolingConfig, lastMove: CoolingState["lastMove"], finished = false): CoolingState {
  const now = read(round);
  const heat = (now.state as { heat: { heat: number } }).heat.heat;
  const state: CoolingState = {
    config,
    cells: cellsOf(now.board, config),
    rng: round.state.streams.rise ?? { a: 0, b: 0, c: 0, d: 0 },
    nextId: round.state.nextId,
    moveCount: now.movesMade,
    score: now.score,
    heat,
    heatRow: Math.floor(heat / (config.heatRisePerMoves * config.heatDropPerPoints)),
    combo: now.streak,
    misses: round.state.misses,
    bestCombo: round.state.best,
    lastMove,
    finished: finished || now.ended !== null,
  };
  return held(state, round);
}

export const COOLING_MIRROR: PuzzleDef<CoolingState, CoolingMove, CoolingConfig> = {
  ...COOLING_DEF,
  create: (seed, config) => {
    COOLING_DEF.validateConfig(config);
    return shown(start(cooling, { seed, settings: coolingSettings(config) }) as Round<AnyMove>, config, null);
  },
  reduce: (state, move) => {
    if (state.finished) throw new InvalidMoveError("game is finished", move);
    const round = roundOf(state);
    // Ending early is the host's, and the heat a ship injects is not built on the new engine: the board keeps its own.
    if (move.type === "end") return shown(round, state.config, { move, rounds: [], points: 0, streakPercent: 100 }, true);
    if (move.type === "heat") throw new InvalidMoveError("the board keeps its own heat", move);
    const y = state.config.height - 1 - move.row;
    const next = play(round, { move: "swap", a: { x: move.col, y }, b: { x: move.col + 1, y } });
    if (next.last.refused) throw new InvalidMoveError(next.last.refused, move);
    const rounds = roundsOf(read(round).board, next.last.events, state.config);
    const percents = round.settings.streakPercent as readonly number[];
    const streakPercent = rounds.length > 0 ? percents[Math.min(round.state.streak, percents.length - 1)]! : 100;
    return shown(next, state.config, { move, rounds, points: next.last.banked, streakPercent });
  },
};
