/**
 * Tug for the bots: a choice is one flick of one pod, or a skip. Every flick the engine allows is
 * offered (at most four pods times four directions), and where a pod stops, which flick delivers and
 * the shortest route to a clamp are the engine's own `tugSlide`, `tugClampDelivered`, `tugSolve`
 * and `tugHint`. The one exception is the pair planner's search over both lit clamps at once, which
 * glides pods itself for speed: the rule it glides by is the engine's, and its every flick is played
 * through the engine. Tug has no clock of its own, so a person is modelled by the seconds a flick
 * takes, from the tuning notes' bots.
 */
import {
  TUG_DEF,
  tugClampDelivered,
  tugFlickIllegalReason,
  tugHint,
  tugLitClamps,
  tugSlide,
  tugSolve,
  type TugClamp,
  type TugConfig,
  type TugDir,
  type TugMove,
  type TugState,
} from "@openseas/engine";
import type { Bot, BotGame, Choice } from "../core.js";

/** A person's pace, from the tuning notes: their bots were weighed over 60 flicks, a 120 second round. */
const SECONDS_PER_FLICK = 120 / 60;
const DIRS: readonly TugDir[] = [0, 1, 2, 3];
const SKIP: Choice<TugMove> = { moves: [{ type: "skip" }] };
/** As deep as the engine measures a clamp a delivery left lit (`maxPar + 2`). */
const deepest = (state: TugState): number => state.config.maxPar + 2;

/** Every flick the engine allows from here, pods and directions in order. */
function flicks(state: TugState): Choice<TugMove>[] {
  const out: Choice<TugMove>[] = [];
  for (let pod = 0; pod < state.pods.length; pod++) {
    for (const dir of DIRS) if (tugFlickIllegalReason(state, pod, dir) === null) out.push({ moves: [{ type: "flick", pod, dir }] });
  }
  return out;
}

/** The flicks that deliver a lit clamp now, the ones the ghosts show. */
function delivering(state: TugState): Choice<TugMove>[] {
  const out: Choice<TugMove>[] = [];
  for (const { pod } of tugLitClamps(state)) {
    for (const dir of DIRS) {
      if (tugFlickIllegalReason(state, pod, dir) === null && tugClampDelivered(state, pod, tugSlide(state, pod, dir).to)) out.push({ moves: [{ type: "flick", pod, dir }] });
    }
  }
  return out;
}

/** The first flick of the shortest route to whichever lit clamp is nearer, `depth` flicks at most (the idle hint), or null. */
function nearestFlick(state: TugState, depth: number): Choice<TugMove> | null {
  const first = tugHint(state, depth)?.route[0];
  return first ? { moves: [first] } : null;
}

/**
 * The tuning notes' ghost reader: it sees one flick ahead, as the ghosts show. A flick that delivers
 * is taken; otherwise a wanted pod is flicked somewhere (most of the time) or any pod is.
 */
function ghostChoice(state: TugState, rng: { int(n: number): number; pick<T>(xs: readonly T[]): T }): Choice<TugMove> | null {
  const now = delivering(state);
  if (now.length) return rng.pick(now);
  const all = flicks(state);
  if (all.length === 0) return SKIP;
  const wantedPods = tugLitClamps(state).map((c) => c.pod);
  const wanted = all.filter((c) => c.moves[0]?.type === "flick" && wantedPods.includes(c.moves[0].pod));
  return wanted.length && rng.int(4) < 3 ? rng.pick(wanted) : rng.pick(all);
}

function ghostBot(): Bot<TugState, TugMove> {
  return {
    name: "ghost reader",
    about: "Sees one flick ahead: takes a flick that delivers, else flicks a wanted pod (three times in four) or any pod.",
    choose: (state, ctx) => ghostChoice(state, ctx.rng),
  };
}

/** Plain thinking play for Tug, the bot the careless check reads: no single flick pays, so it looks two ahead. */
function twoFlickBot(): Bot<TugState, TugMove> {
  return {
    name: "two flicks",
    about: "Sees any route of two flicks or fewer to a lit clamp and plays it; else plays as the ghost reader.",
    choose: (state, ctx) => nearestFlick(state, 2) ?? ghostChoice(state, ctx.rng),
  };
}

/**
 * The finisher: the par route to the clamp lit longest, and no other. With one clamp it is the
 * notes' machine that never thinks; with pairs it is the bait, finishing what it started.
 */
function finisherBot(): Bot<TugState, TugMove> {
  return {
    name: "finisher",
    about: "Plays the par route to the clamp lit longest and never looks at the other (with one clamp, the notes' machine that never thinks; with pairs, the bait).",
    choose(state) {
      const first = tugSolve(state, Math.max(state.config.maxPar, Math.min(deepest(state), state.clamp.par)))?.[0];
      return first ? { moves: [first] } : SKIP;
    },
  };
}

/** Sees both lit clamps and plays the par route to the nearer, one clamp at a time: the idle hint, every flick. */
function nearestBot(): Bot<TugState, TugMove> {
  return {
    name: "nearest first",
    about: "Sees both lit clamps and plays the par route to the nearer one (the idle hint), one clamp at a time.",
    choose: (state) => nearestFlick(state, deepest(state)) ?? SKIP,
  };
}

/**
 * The drift waiter, the pitch's worry about keeping the worth: it leaves the clamp worth more lit
 * and delivers the other, again and again, until the one worth more has drifted to a flick away,
 * then takes it at par one for its full worth.
 */
function waiterBot(): Bot<TugState, TugMove> {
  return {
    name: "drift waiter",
    about: "Delivers the clamp worth less, over and over, until the one worth more has drifted to a flick away, then takes it (the pitch's worry: waiting for a clamp to drift close).",
    choose(state) {
      const lit = tugLitClamps(state);
      if (lit.length < 2) return nearestFlick(state, deepest(state)) ?? SKIP;
      const [rich, poor] = lit[1]!.worth > lit[0]!.worth ? [lit[1]!, lit[0]!] : [lit[0]!, lit[1]!];
      const target = rich.worth > poor.worth && rich.par > 1 ? poor : rich.worth > poor.worth ? rich : null;
      if (!target) return nearestFlick(state, deepest(state)) ?? SKIP;
      const first = tugSolve(state, deepest(state), target)?.[0];
      return first ? { moves: [first] } : (nearestFlick(state, deepest(state)) ?? SKIP);
    },
  };
}

/**
 * The pair planner's search: the fewest flicks that deliver both lit clamps, in either order, the
 * first delivered within its par so the streak holds, and the pod it leaves free to be a stop for
 * the second. Breadth first over bays, each keyed with which clamps are done. The second leg is
 * then a shortest route from the bay the first leaves, which is the par the engine measures it at,
 * so it is clean too.
 */
function pairRoute(state: TugState, maxDepth: number): Array<{ pod: number; dir: TugDir }> | null {
  const cfg = state.config;
  const W = cfg.width;
  const H = cfg.height;
  const cells = W * H;
  const n = state.pods.length;
  const mask = new Uint8Array(cells);
  for (const b of state.blocks) mask[b] = 1;
  const lit: TugClamp[] = tugLitClamps(state);
  const DX = [0, 1, 0, -1];
  const DY = [-1, 0, 1, 0];
  const occ = new Uint8Array(cells);
  const key = (pods: readonly number[], done: number): number => {
    let k = done;
    for (let p = n - 1; p >= 0; p--) k = k * cells + pods[p]!;
    return k;
  };
  const full = (1 << lit.length) - 1;
  type Node = { pods: number[]; done: number; parent: number; via: number };
  const nodes: Node[] = [{ pods: state.pods.slice(), done: 0, parent: -1, via: -1 }];
  const seen = new Set<number>([key(state.pods, 0)]);
  let from = 0;
  for (let d = 1; d <= maxDepth; d++) {
    const end = nodes.length;
    for (let i = from; i < end; i++) {
      const s = nodes[i]!;
      for (let p = 0; p < n; p++) occ[s.pods[p]!] = 1;
      for (let p = 0; p < n; p++) {
        const at = s.pods[p]!;
        for (let dir = 0; dir < 4; dir++) {
          let col = at % W;
          let row = (at - col) / W;
          for (;;) {
            const c = col + DX[dir]!;
            const r = row + DY[dir]!;
            if (c < 0 || c >= W || r < 0 || r >= H) break;
            const cell = r * W + c;
            if (mask[cell] === 1 || occ[cell] === 1) break;
            col = c;
            row = r;
          }
          const to = row * W + col;
          if (to === at) continue;
          let done = s.done;
          let late = false;
          lit.forEach((c, j) => {
            if (c.pod !== p || c.cell !== to || (done & (1 << j)) !== 0) return;
            // The first delivery of the pair must be clean, or the streak breaks.
            if (s.done === 0 && state.flicks + d > c.par) late = true;
            done |= 1 << j;
          });
          if (late) continue;
          const pods = s.pods.slice();
          pods[p] = to;
          const node: Node = { pods, done, parent: i, via: p * 4 + dir };
          if (done === full) {
            for (let q = 0; q < n; q++) occ[s.pods[q]!] = 0;
            const out: Array<{ pod: number; dir: TugDir }> = [];
            for (let k: Node = node; k.parent >= 0; k = nodes[k.parent]!) out.push({ pod: Math.floor(k.via / 4), dir: (k.via % 4) as TugDir });
            return out.reverse();
          }
          const kk = key(pods, done);
          if (seen.has(kk)) continue;
          seen.add(kk);
          nodes.push(node);
        }
      }
      for (let p = 0; p < n; p++) occ[s.pods[p]!] = 0;
    }
    from = end;
    if (nodes.length > 400_000) return null;
  }
  return null;
}

/**
 * Plans both lit clamps as one: the fewest flicks that deliver the pair, the first delivery left as
 * a stop for the second where that is shorter: the handoff. It plans again whenever a clamp lights
 * or the bay is not where its plan left it.
 */
function pairBot(): Bot<TugState, TugMove> {
  let plan: Array<{ pod: number; dir: TugDir }> = [];
  let expect = "";
  const sig = (s: TugState): string => `${s.pods.join(",")}|${tugLitClamps(s).map((c) => `${c.pod}:${c.cell}`).join(",")}|${s.logLength}`;
  return {
    name: "pair planner",
    about: "Sees both lit clamps and plays the fewest flicks that deliver the pair, the first delivery left as a stop for the second (the handoff).",
    choose(state) {
      if (!state.clamp2) return nearestFlick(state, deepest(state)) ?? SKIP;
      if (sig(state) !== expect || plan.length === 0) plan = pairRoute(state, 7) ?? [];
      const next = plan.shift();
      expect = "";
      if (!next) return nearestFlick(state, deepest(state)) ?? SKIP;
      // Hold the plan only while no clamp lights: a delivery deals a new clamp, so plan again then.
      const to = tugSlide(state, next.pod, next.dir).to;
      if (!tugClampDelivered(state, next.pod, to)) {
        const pods = state.pods.slice();
        pods[next.pod] = to;
        expect = `${pods.join(",")}|${tugLitClamps(state).map((c) => `${c.pod}:${c.cell}`).join(",")}|${state.logLength + 1}`;
      }
      return { moves: [{ type: "flick", pod: next.pod, dir: next.dir }] };
    },
  };
}

/** A number in [0, 1) fixed by the clamp and a try count, so a player's read of a clamp holds across its flicks. */
function roll(state: TugState, clamp: TugClamp, attempt: number, salt: number): number {
  let h = 2166136261 ^ salt;
  for (const v of [state.delivered, state.skipped, clamp.pod, clamp.cell, clamp.par, attempt, ...state.pods]) {
    h = Math.imul(h ^ v, 16777619);
    h ^= h >>> 13;
  }
  return (h >>> 0) / 4294967296;
}

/**
 * A modelled player from the tuning notes: odds of seeing the par route by the clamp's par. It
 * looks at the nearer lit clamp (the lower par; the one lit longer on a tie). A clamp it reads is
 * played on the par route; one it does not is played as the ghost reader would, and after par plus
 * the slack in flicks it looks again. Still out of reach after that many looks, it skips.
 */
function modelBot(name: string, about: string, odds: readonly number[], salt: number): Bot<TugState, TugMove> {
  return {
    name,
    about,
    choose(state, ctx) {
      const clamp = tugLitClamps(state).reduce((a, b) => (b.par < a.par ? b : a));
      const par = clamp.par;
      const window = par + state.config.slack + 1;
      const attempt = Math.floor(state.flicks / window);
      if (attempt >= 3) return SKIP;
      const sees = roll(state, clamp, attempt, salt) < (odds[Math.min(par, odds.length) - 1] ?? 0);
      if (sees) {
        const first = tugSolve(state, Math.max(par, state.config.maxPar), clamp)?.[0];
        if (first) return { moves: [first] };
        // Wandered past where a route is in reach: give it up.
        return SKIP;
      }
      return ghostChoice(state, ctx.rng);
    },
  };
}

export const TUG_BOTS: BotGame<TugState, TugMove, TugConfig> = {
  id: "tug",
  def: TUG_DEF,
  pace: "60 flicks in 120 s",
  elapsed: (s) => s.logLength * SECONDS_PER_FLICK,
  choices: (s): Choice<TugMove>[] => [...flicks(s), SKIP],
  end: () => ({ type: "end" }),
  // A skip always costs its penalty to a one-move player, even with nothing to lose yet.
  worth: (before, after, choice) => (choice.moves[0]?.type === "skip" ? -before.config.skipPenalty : after.score - before.score),
  open: true,
  bots: [
    ghostBot(),
    twoFlickBot(),
    modelBot("novice", "Sees the par route at par one and two nearly always, at par three under half the time, rarely at four; else plays as the ghost reader.", [0.95, 0.95, 0.45, 0.15], 1),
    modelBot("steady", "Sees the par route at par three three times in four and at four half the time; else plays as the ghost reader.", [1, 0.95, 0.75, 0.5], 2),
    finisherBot(),
    nearestBot(),
    pairBot(),
    waiterBot(),
  ],
  // No single flick pays in Tug, so one move is not plain thinking play: two flicks is.
  plain: "two flicks",
  baits: [
    { bait: "finisher", beats: "nearest first" },
    { bait: "finisher", beats: "pair planner" },
  ],
  slow: ["pair planner"],
};
