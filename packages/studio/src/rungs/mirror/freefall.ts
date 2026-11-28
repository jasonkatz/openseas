// Freefall on the new engine, shown as the state the prototype's board draws (ADR 0097, ADR 0099). The round is
// played by `@openseas/puzzle`: the shaft, every drop and how the rockers settle, the landings and what they bring,
// the rival's drop and its pick, the legs and the lead. This file only turns what that round reports into the old
// shape, so the board, its sounds and its page are the prototype's, unchanged.
//
// The new engine counts pods; it never names one. The board animates each pod by name, row by row, so a drop's
// frames are drawn here by the prototype's own fall on the shaft as it was shown, and held to what the round says
// came of it: the same rockers, the same landings. Where the two part, the mirror refuses to show the move.
import { FREEFALL_DEF, FREEFALL_LEGS, freefallFall, InvalidMoveError, type FreefallConfig, type FreefallDrop, type FreefallMove, type FreefallRocker, type FreefallState, type PuzzleDef } from "@openseas/engine";
import { play, read, seedFromString, start, type AnyMove, type Event, type Round, type Setting } from "@openseas/puzzle";
import freefall, { type Shaft } from "@openseas/puzzle/examples/freefall";
import { held, roundOf } from "./held.js";

/** The prototype's numbers under the names the new puzzle gives them: each leg's berths a list of its own. */
export function freefallSettings(c: FreefallConfig): Record<string, Setting> {
  return {
    width: c.width, rows: c.rows, maxMoves: c.maxMoves, entry: c.entry, gapPermille: c.gapPermille, quotas: c.quotas,
    berths1: c.bays.first, berths2: c.bays.second, berths3: c.bays.third, berths4: c.bays.fourth, berths5: c.bays.fifth,
    squareClusters: c.squareClusters, rival: c.rival, rivalSkill: c.rivalSkill,
  };
}

const LAST_LEG = FREEFALL_LEGS.length - 1;
type Kept = Pick<FreefallState, "rockers" | "nextId" | "moveCount">;

function shown(round: Round<AnyMove>, config: FreefallConfig, kept: Kept, lastMove: FreefallState["lastMove"], ended = false): FreefallState {
  const now = read(round);
  const shaft = (now.state as { shaft: Shaft }).shaft;
  const stat = (id: string): number => (now.stats as Record<string, number>)[id] ?? 0;
  const over = shaft.leg > LAST_LEG;
  const state: FreefallState = {
    config,
    rockers: kept.rockers,
    rng: round.state.streams.shaft!,
    nextId: kept.nextId,
    leg: Math.min(shaft.leg, LAST_LEG),
    legPoints: shaft.legPoints,
    totals: shaft.totals,
    closing: shaft.closing,
    score: now.score,
    moveCount: kept.moveCount,
    rivalDrops: stat("rivalDrops"),
    legsWon: stat("legsWon"),
    bestCombo: stat("bestCombo"),
    bestCluster: stat("bestCluster"),
    lastMove,
    finished: ended || over || kept.moveCount >= config.maxMoves,
  };
  return held(state, round);
}

/**
 * One side's drop, framed by the prototype's fall on the shaft as it was shown, in the leg it was dropped in, and held
 * to what the round's events say it did: the same landings, and the same rockers where the round shows them.
 */
function framed(c: FreefallConfig, rockers: readonly FreefallRocker[], id: number, leg: number, own: readonly Event[], settled: Shaft["rockers"] | null): FreefallDrop {
  const drop = own[0]!;
  const side = drop.fields.side as 0 | 1;
  const lane = drop.fields.lane as number;
  const lands = own.filter((e) => e.event === "land");
  const f = freefallFall(c, rockers, leg, lane, id);
  const sameLandings = f.landed.length === lands.length && f.landed.every((l, i) => l.lane === lands[i]!.fields.lane && l.ids.length === lands[i]!.fields.pods);
  const sameRockers = settled === null || f.rockers.every((k, i) => k.cradle === settled[i]!.cradle && (k.pod !== 0) === (settled[i]!.pod === 1));
  if (!sameLandings || !sameRockers) throw new Error("the prototype's fall and the new engine's part");
  const landed = f.landed.map((l, i) => ({ ...l, points: lands[i]!.fields.worth as number }));
  return { side, lane, id, steps: f.steps, landed, points: landed.reduce((a, l) => a + l.points, 0), leg, rockers: f.rockers, legEnded: own.some((e) => e.event === "leg") };
}

const deal = (seed: string, config: FreefallConfig): Round<AnyMove> =>
  start(freefall, { seed, settings: freefallSettings(config), streams: { shaft: seedFromString(`freefall:${seed}`) } }) as unknown as Round<AnyMove>;

export const FREEFALL_MIRROR: PuzzleDef<FreefallState, FreefallMove, FreefallConfig> = {
  ...FREEFALL_DEF,
  create: (seed, config) => {
    FREEFALL_DEF.validateConfig(config);
    const round = deal(seed, config);
    const rockers = (read(round).state as { shaft: Shaft }).shaft.rockers.map((k) => ({ lane: k.lane, row: k.row, cradle: k.cradle, pod: 0 }));
    return shown(round, config, { rockers, nextId: 1, moveCount: 0 }, null);
  },
  reduce: (state, move) => {
    if (state.finished) throw new InvalidMoveError("game is finished", move);
    const round = roundOf(state);
    const c = state.config;
    // Ending early is the host's.
    if (move.type === "end") return shown(round, c, { rockers: state.rockers, nextId: state.nextId, moveCount: state.moveCount }, null, true);
    const next = play(round, { move: "drop", lane: move.lane });
    if (next.last.refused) throw new InvalidMoveError(next.last.refused, move);
    const events = next.last.events;
    // Each drop's events run from its own `drop` to the next one's. The round shows the shaft only as the last left it.
    const starts = events.flatMap((e, i) => (e.event === "drop" ? [i] : []));
    const settled = (read(next).state as { shaft: Shaft }).shaft.rockers;
    const drops: FreefallDrop[] = [];
    let [rockers, nextId, leg] = [state.rockers, state.nextId, state.leg];
    starts.forEach((s, k) => {
      const d = framed(c, rockers, nextId, leg, events.slice(s, starts[k + 1] ?? events.length), k === starts.length - 1 ? settled : null);
      drops.push(d);
      rockers = d.rockers;
      nextId++;
      if (d.legEnded) leg = Math.min(leg + 1, LAST_LEG);
    });
    return shown(next, c, { rockers, nextId, moveCount: state.moveCount + 1 }, { move, drops });
  },
};
