// Freefall, a prototype puzzle, written on rungs 2 and 3: cargo pods dropped down a shaft of rockers into the berths at
// its foot, against a rival that drops after every drop of the player's. The shaft widens as it falls; a rocker spans
// two lanes, a cradle and an arm. A pod onto an empty cradle rests there, onto a full one rolls to the arm, and past an
// arm flips the rocker, tossing whatever rested in its cradle. Everything in motion falls a row at a time, so pods that
// meet fuse into a cluster, and a cluster of n into a berth worth v brings v times n times n. A round is five legs, each
// with a quota and its own berth values; when one side reaches the quota the other drops once more and the leg ends.
// The rival plays inside the move from the round's own luck, so a round replays from the player's drops alone. What a
// landing brings is a payout counted at a worth the landing carries, and the score is the player's lead. One part of its
// own holds the shaft, the legs and the rival.
//
// The tests play it beside the engine the studio deals, drop for drop, and hold the two to the same shaft, legs, totals
// and score.
import { budget, grid, part, puzzle, type Board, type Cell, type Ctx, type View } from "../src/index.js";

export type DropMove = { readonly move: "drop"; readonly lane: number };
/** A rocker: the left of its two lanes, its row, which side its cradle is on (0 left, 1 right), and whether a pod rests in it. */
export interface Rocker { readonly lane: number; readonly row: number; readonly cradle: 0 | 1; readonly pod: 0 | 1 }
/**
 * The shaft's rockers, the leg being played (5 once the round is over), each side's points in the leg and over the
 * round (player, rival), and who reached the leg's quota first, while the other's closing drop is to come.
 */
export interface Shaft { readonly rockers: readonly Rocker[]; readonly leg: number; readonly legPoints: readonly [number, number]; readonly totals: readonly [number, number]; readonly closing: 0 | 1 | null }

const LEGS = 5;
const numbers = (view: View): Record<string, number> => view.settings as Record<string, number>;

/** The lanes a row spans, first and last: the entry lanes at the top, widening to the whole width at the foot. */
export function rowSpan(width: number, entry: number, rows: number, row: number): [number, number] {
  const grow = (width - entry) / 2;
  const lo = grow - (rows > 1 ? Math.round((row * grow) / (rows - 1)) : grow);
  return [lo, width - 1 - lo];
}
const entryLanes = (view: View): [number, number] => {
  const { width, entry } = numbers(view);
  const lo = (width! - entry!) / 2;
  return [lo, lo + entry! - 1];
};
/** What the berth under a lane pays in a leg: its leg's values run from the middle lane outward, mirrored. */
const berth = (view: View, leg: number, lane: number): number => {
  const half = view.board.width / 2;
  return (view.settings[`berths${Math.min(leg, LEGS - 1) + 1}`] as readonly number[])[lane < half ? half - 1 - lane : lane - half] ?? 0;
};

interface Fall { readonly rockers: Rocker[]; readonly landed: { lane: number; pods: number }[] }
/** One pod down a lane and everything it sets off, a row at a time, on a copy of the shaft. Only counts of pods matter. */
export function fall(width: number, rows: number, shaft: readonly Rocker[], lane: number): Fall {
  const rockers = shaft.map((r) => ({ ...r }));
  const table = Array.from({ length: rows }, () => new Array<number>(width).fill(-1));
  rockers.forEach((k, i) => (table[k.row]![k.lane] = table[k.row]![k.lane + 1] = i));
  let moving = new Map<number, number>([[lane, 1]]);
  for (let row = 0; row < rows; row++) {
    const next = new Map<number, number>();
    const push = (l: number, n: number): void => void next.set(l, (next.get(l) ?? 0) + n);
    const done = new Set<number>();
    for (const l of [...moving.keys()].sort((a, b) => a - b)) {
      const ri = table[row]![l]!;
      if (ri < 0) {
        push(l, moving.get(l)!);
        continue;
      }
      if (done.has(ri)) continue;
      done.add(ri);
      const k = rockers[ri]!;
      const [cl, al] = [k.lane + k.cradle, k.lane + 1 - k.cradle];
      const atCradle = moving.get(cl) ?? 0;
      // One pod from the cradle side rests in an empty cradle; the rest roll over to the arm and flip it.
      const rests = atCradle > 0 && k.pod === 0 ? 1 : 0;
      const passing = (moving.get(al) ?? 0) + atCradle - rests;
      if (passing % 2 === 1) {
        // An odd number of flips: the cradle swings over, and whatever lay in it falls down its lane.
        if (k.pod === 1 || rests === 1) push(cl, 1);
        k.pod = 0;
        k.cradle = (1 - k.cradle) as 0 | 1;
      } else if (rests === 1) k.pod = 1;
      if (passing > 0) push(al, passing);
    }
    moving = next;
  }
  return { rockers, landed: [...moving.keys()].sort((a, b) => a - b).map((l) => ({ lane: l, pods: moving.get(l)! })) };
}

/** The rival's lane: the drop worth most at once `rivalSkill` percent of the time, a random one of equals, else any lane. */
function rivalLane(ctx: Ctx<Shaft>, shaft: Shaft): number {
  const n = numbers(ctx);
  const draw = ctx.draw("shaft");
  const [lo, hi] = entryLanes(ctx);
  if (draw.even(100) < n.rivalSkill!) {
    const values = Array.from({ length: hi - lo + 1 }, (_, i) => ({ lane: lo + i, worth: worthOf(ctx, shaft.leg, fall(ctx.board.width, ctx.board.height, shaft.rockers, lo + i).landed) }));
    const best = Math.max(...values.map((v) => v.worth));
    const ties = values.filter((v) => v.worth === best);
    return ties[draw.even(ties.length)]!.lane;
  }
  return lo + draw.even(n.entry!);
}
const landingWorth = (view: View, leg: number, l: { lane: number; pods: number }): number => berth(view, leg, l.lane) * l.pods * (view.settings.squareClusters === true ? l.pods : 1);
const worthOf = (view: View, leg: number, landed: Fall["landed"]): number => landed.reduce((a, l) => a + landingWorth(view, leg, l), 0);

/** The cells a rocker covers, and what each shows: its cradle (empty or holding a pod) and its arm. */
const paint = (k: Rocker): [Cell, { piece: string; state?: number }][] => [
  [{ x: k.lane + k.cradle, y: k.row }, { piece: "cradle", state: k.pod }],
  [{ x: k.lane + 1 - k.cradle, y: k.row }, { piece: "arm" }],
];

/** One side's drop: the fall, the landings and what they bring, and the leg's close. */
function drop(ctx: Ctx<Shaft>, shaft: Shaft, side: 0 | 1, lane: number): Shaft {
  const { width, height } = ctx.board;
  const f = fall(width, height, shaft.rockers, lane);
  const changed = f.rockers.filter((k, i) => k.cradle !== shaft.rockers[i]!.cradle || k.pod !== shaft.rockers[i]!.pod);
  const pods = f.landed.reduce((a, l) => a + l.pods, 0);
  ctx.emit("drop", { side, lane, pods }, (e) => {
    for (const k of changed) for (const [at, look] of paint(k)) e.change(at, look);
    if (side === 1) e.set("rivalDrops", ctx.value("rivalDrops") + 1);
    else if (pods > ctx.value("bestCombo")) e.set("bestCombo", pods);
  });
  const totals: [number, number] = [shaft.totals[0], shaft.totals[1]];
  const legPoints: [number, number] = [shaft.legPoints[0], shaft.legPoints[1]];
  for (const l of f.landed) {
    const worth = landingWorth(ctx, shaft.leg, l);
    const lead = Math.max(0, totals[0] - totals[1]);
    totals[side] += worth;
    legPoints[side] += worth;
    // The score is the player's lead, never below zero: a landing moves it by what it moves the lead.
    ctx.emit("land", { side, lane: l.lane, pods: l.pods, worth, lead: Math.max(0, totals[0] - totals[1]) - lead }, (e) => {
      if (side === 0 && l.pods > ctx.value("bestCluster")) e.set("bestCluster", l.pods);
    });
  }
  let { closing, leg } = shaft;
  let ended = closing !== null && closing !== side;
  if (closing === null && legPoints[side] >= (ctx.settings.quotas as readonly number[])[leg]!) {
    if (ctx.settings.rival === true) closing = side;
    else ended = true;
    ctx.emit("quota", { side, leg }, (e) => (side === 0 ? e.set("legsWon", ctx.value("legsWon") + 1) : e));
  }
  if (ended) {
    ctx.emit("leg", { leg });
    leg++;
    closing = null;
  }
  return { rockers: f.rockers, leg, legPoints: ended ? [0, 0] : legPoints, totals, closing };
}

/** The shaft. The rival drops after every drop of the player's, until the round is over. */
const shaft = part<DropMove, Shaft>({
  name: "shaft",
  rule: "drop a pod down an entry lane; the rival drops after you, and a leg ends a drop after either side reaches its quota",
  pieces: [{ id: "cradle", states: { count: 2 } }, { id: "arm" }],
  moves: [{ id: "drop", description: "drop a pod down one of the entry lanes, counted across the foot", gesture: "tap", fields: { lane: "number" } }],
  events: [
    { id: "deal", description: "the shaft was dealt its rockers", fields: { count: "number" }, changes: ["arrive"] },
    { id: "drop", description: "a side dropped a pod, and the shaft settled", fields: { side: "number", lane: "number", pods: "number" }, changes: ["change"] },
    { id: "land", description: "pods reached a berth, bringing its value times their count, squared when clusters are; the score moves by the lead it moves", fields: { side: "number", lane: "number", pods: "number", worth: "number", lead: "number", points: "points" } },
    { id: "quota", description: "a side reached the leg's quota", fields: { side: "number", leg: "number" } },
    { id: "leg", description: "a leg ended", fields: { leg: "number" } },
  ],
  draws: [{ id: "shaft", description: "each rocker's place in the deal, open or not, and its cradle's side; then the rival's every pick", gives: "piece", by: "even", when: "start", reads: ["gapPermille", "rivalSkill"] }],
  stats: [{ id: "legsWon", description: "legs the player reached the quota of first" }, { id: "rivalDrops", description: "the rival's drops" }, { id: "bestCombo", description: "the most pods one of the player's drops brought down" }, { id: "bestCluster", description: "the largest cluster the player landed" }],
  texts: ["reason.no_lane", "reason.round_done"],
  hooks: {
    onStart(ctx) {
      const { width, height } = ctx.board;
      const n = numbers(ctx);
      const draw = ctx.draw("shaft");
      const rockers: Rocker[] = [];
      for (let row = 0; row < height; row++) {
        const [lo, hi] = rowSpan(width, n.entry!, height, row);
        for (let lane = lo + (row % 2); lane + 1 <= hi; lane += 2) {
          const gap = draw.chance(n.gapPermille!);
          const side = draw.even(2) as 0 | 1;
          if (!gap) rockers.push({ lane, row, cradle: side, pod: 0 });
        }
      }
      ctx.emit("deal", { count: rockers.length }, (e) => rockers.forEach((k) => paint(k).forEach(([at, look]) => e.arrive(at, look))));
      return { rockers, leg: 0, legPoints: [0, 0], totals: [0, 0], closing: null };
    },
    canMove: {
      drop(view, move: DropMove) {
        if (view.state.leg >= LEGS) return "reason.round_done";
        const [lo, hi] = entryLanes(view);
        return Number.isInteger(move.lane) && move.lane >= lo && move.lane <= hi ? null : "reason.no_lane";
      },
    },
    onMove: {
      drop(ctx, _seat, move: DropMove) {
        const mine = drop(ctx, ctx.state, 0, move.lane);
        return mine.leg < LEGS && ctx.settings.rival === true ? drop(ctx, mine, 1, rivalLane(ctx, mine)) : mine;
      },
    },
    listMoves(view) {
      if (view.state.leg >= LEGS) return [];
      const [lo, hi] = entryLanes(view);
      return Array.from({ length: hi - lo + 1 }, (_, i) => ({ move: "drop", lane: lo + i }));
    },
    pointsFor: (event, paid) => (event.event === "land" ? (event.fields.lead as number) : paid),
  },
});

export default puzzle("freefall", {
  board: grid("width", "rows"),
  parts: [shaft],
  ends: budget("maxMoves"),
  settings: {
    width: 8,
    rows: 7,
    maxMoves: 100,
    entry: { default: 4, min: 2, max: 20, description: "lanes across the top, the middle of the width, that a pod is dropped down" },
    gapPermille: { default: 60, min: 0, max: 600, description: "chance in a thousand that a rocker's place is left open" },
    quotas: { default: [12, 40, 24, 70, 90], min: 1, max: 100_000, description: "points a side must reach within each leg to end it, one entry a leg" },
    berths1: { default: [2, 2, 2, 2], min: 0, max: 10_000, description: "the first leg's berth values, from the middle lane outward" },
    berths2: { default: [1, 2, 5, 12], min: 0, max: 10_000, description: "the second leg's berth values, from the middle lane outward" },
    berths3: { default: [1, 3, 5, 8], min: 0, max: 10_000, description: "the third leg's berth values, from the middle lane outward" },
    berths4: { default: [1, 4, 10, 20], min: 0, max: 10_000, description: "the fourth leg's berth values, from the middle lane outward" },
    berths5: { default: [2, 5, 10, 25], min: 0, max: 10_000, description: "the fifth leg's berth values, from the middle lane outward" },
    squareClusters: { default: true, description: "a cluster of n brings its berth n times n times; off, n times" },
    rival: { default: true, description: "a rival drops after every drop of the player's" },
    rivalSkill: { default: 70, min: 0, max: 100, description: "percent of the rival's drops that are the drop worth most at once" },
  },
  // A landing brings its worth to the side that dropped; the score moves by the lead it moves.
  payouts: { landing: { on: "land", counts: "worth" } },
});
