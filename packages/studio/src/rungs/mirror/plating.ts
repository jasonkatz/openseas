// Plating on the new engine, shown as the state the game's board draws (ADR 0097, ADR 0098). The round is played by
// `@openseas/puzzle`: the tray and every plate dealt to it, where each breach opens and widens, where a plate is laid
// and what it wastes, each seal's rating, the points and the flawless streak. This file only turns what that round
// reports into the shipped shape, so the board, its sounds and its page are the game's, unchanged.
import {
  InvalidMoveError,
  PLATING_DEF,
  platingHasLegalPlacement,
  platingOrient,
  type Breach,
  type BreachRating,
  type Plate,
  type PlatingConfig,
  type PlatingMove,
  type PlatingMoveReport,
  type PlatingState,
  type PuzzleDef,
  type SealedBreach,
} from "@openseas/engine";
import { play, read, seedFromString, start, type AnyMove, type Cell, type Round, type Setting } from "@openseas/puzzle";
import plating, { type Hull } from "@openseas/puzzle/examples/plating";
import { held, roundOf } from "./held.js";

const RATINGS: readonly BreachRating[] = ["flawless", "solid", "holds", "tape", "gum"];

/** The game's numbers under the names the new puzzle gives them; the brushing bonus is a multiplier in percent. */
export function platingSettings(c: PlatingConfig): Record<string, Setting> {
  return {
    width: c.width, height: c.height, maxMoves: c.maxMoves, metals: c.pieceKinds, breachesAtOnce: c.breachesAtOnce, breachLeast: c.minBreachPieces, breachMost: c.maxBreachPieces,
    widenAfter: c.growAfterMoves, basePerCell: c.basePerCell, flawlessPercent: c.multiplierPercent.flawless, solidPercent: c.multiplierPercent.solid, holdsPercent: c.multiplierPercent.holds,
    tapePercent: c.multiplierPercent.tape, gumPercent: c.multiplierPercent.gum, acrossPercent: 100 + c.brushBonusPercent, streakPercent: c.streakPercent,
  };
}

/**
 * The shipped engine numbers plates and breaches from one count, and the new engine keeps no plate as a whole and
 * numbers its breaches alone. So the mirror keeps the plates it saw welded and gives each plate and breach the
 * shipped number as it comes: `alias` takes a breach's number on the new engine to the number shown.
 */
interface Kept { readonly plates: readonly Plate[]; readonly alias: ReadonlyMap<number, number>; readonly nextId: number; readonly moveCount: number; readonly bestCombo: number }
const KEPT = new WeakMap<object, Kept>();

function shown(round: Round<AnyMove>, config: PlatingConfig, kept: Kept, lastMove: PlatingMoveReport | null, ended = false): PlatingState {
  const now = read(round);
  const hull = (now.state as { hull: Hull }).hull;
  const covered = new Array<number>(config.width * config.height).fill(0);
  for (const p of kept.plates) for (const c of p.cells) covered[c]!++;
  const breaches: Breach[] = hull.breaches.map((b) => ({ id: kept.alias.get(b.id)!, cells: b.cells, pieces: b.plates, waste: b.waste, idleMoves: b.idle, grown: b.widened, allHorizontal: b.across }));
  const state: PlatingState = {
    config,
    breaches,
    plates: kept.plates,
    covered,
    slots: hull.tray.map((p) => ({ shape: p.shape, brush: p.brush === "across" ? "h" : "v", kind: p.kind })),
    rng: round.state.streams.hull!,
    nextId: kept.nextId,
    moveCount: kept.moveCount,
    score: now.score,
    combo: now.streak,
    bestCombo: Math.max(kept.bestCombo, now.streak),
    sealedCount: (now.stats as Record<string, number>).sealed ?? 0,
    lastMove,
    finished: false,
  };
  // The new engine ends a round by its clock and its budget; the game's also ends it when no plate fits.
  const finished = ended || kept.moveCount >= config.maxMoves || !platingHasLegalPlacement(state);
  const out = { ...state, finished };
  KEPT.set(out, { ...kept, bestCombo: state.bestCombo });
  return held(out, round);
}

/** Names each breach the round opened in `events`, in order, from the shipped count. */
function named(events: Round<AnyMove>["last"]["events"], alias: Map<number, number>, nextId: number, hullAfter: Hull, hullBefore: readonly number[]): number {
  const fresh = hullAfter.breaches.filter((b) => !hullBefore.includes(b.id));
  if (fresh.length !== events.filter((e) => e.event === "breach").length) throw new Error("the breaches the round opened are not the breaches it holds");
  for (const b of fresh) alias.set(b.id, nextId++);
  return nextId;
}

const at = (c: PlatingConfig, p: Cell): number => p.y * c.width + p.x;

export const PLATING_MIRROR: PuzzleDef<PlatingState, PlatingMove, PlatingConfig> = {
  ...PLATING_DEF,
  create: (seed, config) => {
    PLATING_DEF.validateConfig(config);
    const round = start(plating, { seed, settings: platingSettings(config), streams: { hull: seedFromString(`carpentry:${seed}`) } }) as unknown as Round<AnyMove>;
    const alias = new Map<number, number>();
    const nextId = named(round.last.events, alias, 1, (read(round).state as { hull: Hull }).hull, []);
    return shown(round, config, { plates: [], alias, nextId, moveCount: 0, bestCombo: 0 }, null);
  },
  reduce: (state, move) => {
    if (state.finished) throw new InvalidMoveError("game is finished", move);
    const kept = KEPT.get(state)!;
    const c = state.config;
    const round = roundOf(state);
    if (move.type === "end") return shown(round, c, kept, { move, placed: null, sealed: null, spawned: [], grown: null, points: 0 }, true);
    if (move.type !== "place") throw new InvalidMoveError(`unknown move ${JSON.stringify(move)}`, move);
    if (typeof move.flip !== "boolean" || !Number.isInteger(move.col) || !Number.isInteger(move.row)) throw new InvalidMoveError("bad position", move);
    const next = play(round, { move: "place", slot: move.slot, rot: move.rot, flip: move.flip, x: move.col, y: move.row });
    if (next.last.refused) throw new InvalidMoveError(next.last.refused, move);
    const before = (read(round).state as { hull: Hull }).hull;
    const after = (read(next).state as { hull: Hull }).hull;
    const alias = new Map(kept.alias);
    const events = next.last.events;
    const weld = events.find((e) => e.event === "weld")!;
    const wf = weld.fields as { cells: Cell[]; waste: Cell[]; breach: number };
    const piece = state.slots[move.slot]!;
    const brush = move.rot % 2 === 0 ? piece.brush : piece.brush === "h" ? "v" : "h";
    let nextId = kept.nextId;
    const plate: Plate = { id: nextId++, shape: piece.shape, kind: piece.kind, brush, cells: wf.cells.map((p) => at(c, p)), breachId: alias.get(wf.breach)! };
    let plates = [...kept.plates, plate];
    const widen = events.find((e) => e.event === "widen");
    const grown = widen ? { breachId: alias.get(widen.fields.breach as number)!, cell: at(c, widen.fields.at as Cell) } : null;
    // A seal's report, from the breach as the weld left it.
    const seal = events.find((e) => e.event === "flawless" || e.event === "seal");
    let sealed: SealedBreach | null = null;
    if (seal) {
      const was = before.breaches.find((b) => b.id === wf.breach)!;
      const cells = (seal.fields.cells as Cell[]).map((p) => at(c, p)).sort((a, b) => a - b);
      const pieces = was.plates + 1;
      const waste = was.waste + wf.waste.length + overhang(c, piece.shape, move.rot, move.flip, move.col, move.row);
      const extra = Math.max(0, pieces - Math.ceil(cells.length / 5));
      const rating = seal.event === "flawless" ? "flawless" : RATINGS[seal.fields.rating as number]!;
      const chain = rating === "flawless" ? read(next).streak : 1;
      const streakPercent = rating === "flawless" ? c.streakPercent[Math.min(chain, c.streakPercent.length) - 1]! : 100;
      sealed = { breachId: plate.breachId, cells, rating, extra, waste, brushBonus: seal.fields.across === true, chain, streakPercent, points: next.last.banked };
      plates = plates.filter((p) => p.breachId !== plate.breachId);
    }
    const ids = before.breaches.map((b) => b.id);
    const firstNew = nextId;
    nextId = named(events, alias, nextId, after, ids);
    const spawned: Breach[] = after.breaches.filter((b) => alias.get(b.id)! >= firstNew).map((b) => ({ id: alias.get(b.id)!, cells: b.cells, pieces: 0, waste: 0, idleMoves: 0, grown: false, allHorizontal: true }));
    for (const id of [...alias.keys()]) if (!after.breaches.some((b) => b.id === id)) alias.delete(id);
    const placed = { plate, wasteCells: wf.waste.map((p) => at(c, p)) };
    const report: PlatingMoveReport = { move, placed, sealed, spawned, grown, points: next.last.banked };
    return shown(next, c, { plates, alias, nextId, moveCount: kept.moveCount + 1, bestCombo: kept.bestCombo }, report);
  },
};

/** The cells of a plate that hang off the hull: waste the shipped engine adds to its breach, as the new engine does. */
function overhang(c: PlatingConfig, shape: number, rot: number, flip: boolean, col: number, row: number): number {
  return platingOrient(shape, rot, flip).filter(([x, y]) => col + x < 0 || row + y < 0 || col + x >= c.width || row + y >= c.height).length;
}
