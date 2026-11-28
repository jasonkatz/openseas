// Racks on the new engine, shown as the state the prototype's board draws (ADR 0097, ADR 0099). The round is played
// by `@openseas/puzzle`: the opening racks, every shift and call, the crate and where it lands, shipments, spills, the
// points and the chain. This file only turns what that round reports into the old shape, so the board, its sounds
// and its page are the prototype's, unchanged.
import { InvalidMoveError, RACKS_DEF, racksChainPercentAt, racksShipmentPoints, type PuzzleDef, type RacksCell, type RacksConfig, type RacksCrate, type RacksEvent, type RacksMove, type RacksState } from "@openseas/engine";
import { play, read, seedFromString, start, type AnyMove, type Round, type Seen, type Setting } from "@openseas/puzzle";
import racks, { type Yard } from "@openseas/puzzle/examples/racks";
import { held, roundOf } from "./held.js";

/** The prototype's numbers under the names the new puzzle gives them. A spill's penalty is negative points. */
export function racksSettings(c: RacksConfig): Record<string, Setting> {
  return {
    racks: c.racks, height: c.height, kinds: c.kinds, startCells: c.startCells, crateLeast: c.crateMin, crateMost: c.crateMax, mixPercent: c.crateMixPercent,
    landEvery: c.landEvery, bagCopies: c.bagCopies, markRoom: c.markRoom, chainWindow: c.chainWindow, shipPoints: c.shipPoints, chainPercent: c.chainPercent,
    spillPoints: -c.spillPenalty, maxMoves: c.maxMoves,
  };
}

/**
 * The prototype names a crate's cells when it is hung, and they keep that name on the rack. The new engine names a
 * piece when it lands, so each crate cell is named here when hung, the k-th from a number no piece reaches, and the
 * piece it lands as is known by that name.
 */
interface Names { readonly alias: ReadonlyMap<number, number>; readonly hung: number }
const NAMES = new WeakMap<object, Names>();
const CRATE_IDS = 1_000_000;

function shown(round: Round<AnyMove>, config: RacksConfig, names: Names, crate: RacksCrate, prev: RacksState | null, lastMove: RacksState["lastMove"], bestCombo: number, ended = false): RacksState {
  const now = read(round);
  const yard = (now.state as { yard: Yard }).yard;
  const stat = (id: string): number => (now.stats as Record<string, number>)[id] ?? 0;
  const name = (id: number): number => names.alias.get(id) ?? id;
  const rackCells = (board: Seen, r: number): RacksCell[] => {
    const out: RacksCell[] = [];
    for (let y = config.height - 1; y >= 0 && board[y]![r]; y--) out.push({ id: name(board[y]![r]!.id), kind: board[y]![r]!.kind! - 1 });
    return out;
  };
  const shippedByCrate = (prev?.shippedByCrate ?? 0) + (lastMove?.events.filter((e) => e.type === "ship" && e.byCrate).length ?? 0);
  const state: RacksState = {
    config,
    racks: Array.from({ length: config.racks }, (_, r) => rackCells(now.board, r)),
    crate,
    bag: yard.bag.map((k) => k - 1),
    rng: round.state.streams.racks!,
    nextId: round.state.nextId,
    score: now.score,
    moveCount: yard.actions,
    combo: now.streak,
    bestCombo,
    lastShipAt: yard.lastShipAt,
    shipped: stat("shipped"),
    shippedByCrate,
    spills: stat("spills"),
    calls: stat("calls"),
    lastMove,
    finished: ended || yard.actions >= config.maxMoves,
  };
  NAMES.set(state, names);
  return held(state, round);
}

/** The crate the yard hangs, its cells named from the next name free. */
function crateOf(yard: Yard, names: Names): { crate: RacksCrate; names: Names } {
  const cells = yard.crate.kinds.map((kind, i) => ({ id: CRATE_IDS + names.hung + i, kind: kind - 1 }));
  return { crate: { cells, rack: yard.crate.rack, lands: yard.crate.lands }, names: { alias: names.alias, hung: names.hung + cells.length } };
}

const deal = (seed: string, config: RacksConfig): Round<AnyMove> =>
  start(racks, { seed, settings: racksSettings(config), streams: { racks: seedFromString(`racks:${seed}`) } }) as unknown as Round<AnyMove>;

export const RACKS_MIRROR: PuzzleDef<RacksState, RacksMove, RacksConfig> = {
  ...RACKS_DEF,
  create: (seed, config) => {
    RACKS_DEF.validateConfig(config);
    const round = deal(seed, config);
    const { crate, names } = crateOf((read(round).state as { yard: Yard }).yard, { alias: new Map(), hung: 0 });
    return shown(round, config, names, crate, null, null, 0);
  },
  reduce: (state, move) => {
    if (state.finished) throw new InvalidMoveError("game is finished", move);
    const round = roundOf(state);
    const c = state.config;
    let names = NAMES.get(state)!;
    // Ending early is the host's.
    if (move.type === "end") return shown(round, c, names, state.crate, state, null, state.bestCombo, true);
    const next = play(round, move.type === "move" ? { move: "shift", from: move.from, to: move.to } : { move: "call" });
    if (next.last.refused) throw new InvalidMoveError(next.last.refused, move);
    // The cells the move lifted, as named before it, and every event in the prototype's words.
    const alias = new Map(names.alias);
    const racksNow = state.racks.map((r) => r.slice());
    const events: RacksEvent[] = [];
    let crate = state.crate;
    let [combo, best] = [state.combo, state.bestCombo];
    for (const e of next.last.events) {
      const f = e.fields as { from?: number; to?: number; count?: number; rack?: number; kind?: number; byCrate?: boolean; lost?: number; called?: boolean };
      if (e.event === "shift") {
        const moved = racksNow[f.from!]!.splice(racksNow[f.from!]!.length - f.count!, f.count!);
        racksNow[f.to!]!.push(...moved);
        events.push({ type: "move", from: f.from!, to: f.to!, ids: moved.map((m) => m.id) });
      } else if (e.event === "ship") {
        combo += 1;
        best = Math.max(best, combo);
        events.push({ type: "ship", rack: f.rack!, kind: f.kind! - 1, ids: racksNow[f.rack!]!.map((m) => m.id), chain: combo, chainPercent: racksChainPercentAt(c, combo), points: racksShipmentPoints(c, combo), byCrate: f.byCrate! });
        racksNow[f.rack!] = [];
      } else if (e.event === "spill") {
        combo = 0;
        events.push({ type: "spill", rack: f.rack!, ids: racksNow[f.rack!]!.map((m) => m.id), penalty: f.lost! });
        racksNow[f.rack!] = [];
      } else if (e.event === "land") {
        const arrived = e.changes.flatMap((ch) => (ch.change === "arrive" ? [ch.piece.id] : []));
        arrived.forEach((id, i) => alias.set(id, crate.cells[i]!.id));
        racksNow[f.rack!]!.push(...crate.cells);
        events.push({ type: "land", rack: f.rack!, ids: crate.cells.map((m) => m.id), called: f.called! });
      } else if (e.event === "crate") {
        const hung = crateOf((read(next).state as { yard: Yard }).yard, { alias, hung: names.hung });
        [crate, names] = [hung.crate, hung.names];
        events.push({ type: "deal", crate });
      }
    }
    // Only the landing crate's names are kept: a piece that has left is never named again.
    const standing = new Set(read(next).board.flatMap((row) => row.flatMap((p) => (p ? [p.id] : []))));
    for (const id of alias.keys()) if (!standing.has(id)) alias.delete(id);
    names = { alias, hung: names.hung };
    if (move.type === "move" && !events.some((e) => e.type === "deal")) crate = { ...crate, lands: (read(next).state as { yard: Yard }).yard.crate.lands };
    return shown(next, c, names, crate, state, { move, events, points: read(next).score - state.score }, best);
  },
};
