/**
 * Racks for the bots: a choice is one action, a move from one rack to another or a call of the
 * crate. Every move the engine allows is offered (at most five racks times four others) beside the
 * call, so nothing here re-derives the rules: the engine's own `racksMoveIllegalReason`,
 * `racksCrateFits`, `racksWouldShip` and `racksHint` say them. Racks has no clock of its own, so a
 * person is modelled by the seconds an action takes, from the tuning notes' bots.
 */
import {
  RACKS_DEF,
  racksCrateFits,
  racksCrateWouldShip,
  racksHint,
  racksMoveIllegalReason,
  racksNextShipment,
  racksTopGroup,
  racksWouldShip,
  type RacksConfig,
  type RacksMove,
  type RacksState,
} from "@openseas/engine";
import { reseed, type Bot, type BotGame, type Choice } from "../core.js";

/** A person's pace, from the tuning notes: their bots were weighed at 70 actions in a 120 second round. */
const SECONDS_PER_ACTION = 120 / 70;
/** What a smashed rack costs a careful player beyond the penalty: the cells lost with it. */
const SMASH_COST = 100;
/** How many actions the planner looks ahead. */
const PLAN_DEPTH = 3;
/** What the planner sees in each cell a landing brings in: cells that can ship, so a call that is safe pays. */
const DEALT_WORTH = 15;
const CALL: Choice<RacksMove> = { moves: [{ type: "call" }] };

/** Every move the engine allows from here, racks in order, then the call. */
function actions(state: RacksState): Choice<RacksMove>[] {
  const out: Choice<RacksMove>[] = [];
  const n = state.config.racks;
  for (let from = 0; from < n; from++) {
    for (let to = 0; to < n; to++) if (racksMoveIllegalReason(state, from, to) === null) out.push({ moves: [{ type: "move", from, to }] });
  }
  out.push(CALL);
  return out;
}

const asChoice = (move: RacksMove | null): Choice<RacksMove> => (move ? { moves: [move] } : CALL);

/** The tuning notes' blind sorter: the hint's own tidying, shown a crate with nothing in it, so the mark never counts. */
function blindSorterBot(): Bot<RacksState, RacksMove> {
  return {
    name: "blind sorter",
    about: "Sorts like onto like as the hint does but never looks at the crate; calls only when it has nothing to tidy.",
    choose: (state) => asChoice(racksHint({ ...state, crate: { ...state.crate, cells: [] } })),
  };
}

/** The tuning notes' second bot: the hint's own rules, a tidy sorter that watches the mark. */
function hintBot(): Bot<RacksState, RacksMove> {
  return {
    name: "hint rules",
    about: "Plays the board's idle hint: a shipment, room under a crate that will not fit, a tidying move, else the call.",
    choose: (state) => asChoice(racksHint(state)),
  };
}

/** How well ordered the racks are, and what the crate and the chain promise, as a planner reads a state. */
function order(state: RacksState, chain: boolean): number {
  const next = (): number => (chain ? racksNextShipment(state).points : state.config.shipPoints);
  const cfg = state.config;
  let v = 0;
  for (const rack of state.racks) {
    if (rack.length === 0) {
      v += 10;
      continue;
    }
    let breaks = 0;
    for (let i = 1; i < rack.length; i++) if (rack[i]!.kind !== rack[i - 1]!.kind) breaks++;
    if (breaks === 0) v += 4 * rack.length * rack.length;
    else v -= 12 * breaks + 2 * rack.length;
    v += 2 * (racksTopGroup(rack)?.count ?? 0);
  }
  if (!racksCrateFits(state)) v -= 240 / Math.max(1, state.crate.lands);
  else if (racksCrateWouldShip(state)) v += 0.6 * next();
  else {
    // A crate landing on a pure rack of another kind spoils it.
    const under = state.racks[state.crate.rack]!;
    const top = racksTopGroup(under);
    if (top && top.count === under.length && top.kind !== state.crate.cells[0]!.kind) v -= 3 * under.length;
  }
  // A shipment ready for the next action, worth more while a chain runs.
  let ready = false;
  for (let from = 0; from < cfg.racks && !ready; from++) for (let to = 0; to < cfg.racks && !ready; to++) if (racksWouldShip(state, from, to)) ready = true;
  if (ready) v += 0.5 * next();
  return v;
}

/** What a state is worth to the planner over `root`: points made, smashes, cells taken in, and the order left. */
function planValue(root: RacksState, leaf: RacksState, chain: boolean): number {
  const smashes = leaf.spills - root.spills;
  // Cells dealt are cells that can ship: calling brings them sooner.
  const dealt = leaf.nextId - root.nextId;
  const cfg = leaf.config;
  const points = chain ? leaf.score - root.score : cfg.shipPoints * (leaf.shipped - root.shipped) - cfg.spillPenalty * smashes;
  return points - SMASH_COST * smashes + DEALT_WORTH * dealt + order(leaf, chain);
}

/**
 * The tuning notes' planner: every run of three actions on a fresh random stream (it sees the crate
 * that hangs, never the next), and the first action of the run that ends best is taken.
 */
function plannerBot(name: string, about: string, chain: boolean): Bot<RacksState, RacksMove> {
  return {
    name,
    about,
    choose(root, ctx) {
      const start = reseed(root, `plan:${ctx.rng.int(0x7fffffff)}`);
      const search = (s: RacksState, depth: number): number => {
        if (depth === 0 || s.finished) return planValue(root, s, chain);
        let top = -Infinity;
        for (const c of actions(s)) {
          const next = ctx.apply(s, c);
          if (next === null) continue;
          top = Math.max(top, search(next, depth - 1));
        }
        return top === -Infinity ? planValue(root, s, chain) : top;
      };
      let best: Choice<RacksMove>[] = [];
      let bestValue = -Infinity;
      for (const c of actions(start)) {
        const next = ctx.apply(start, c);
        if (next === null) continue;
        const v = search(next, PLAN_DEPTH - 1);
        if (v > bestValue + 1e-9) {
          bestValue = v;
          best = [c];
        } else if (Math.abs(v - bestValue) <= 1e-9) best.push(c);
      }
      return best.length ? ctx.rng.pick(best) : null;
    },
  };
}

export const RACKS_BOTS: BotGame<RacksState, RacksMove, RacksConfig> = {
  id: "racks",
  def: RACKS_DEF,
  pace: "70 actions in 120 s",
  elapsed: (s) => s.moveCount * SECONDS_PER_ACTION,
  choices: actions,
  end: () => ({ type: "end" }),
  // A careful player sees the points, a smash's cost beyond its penalty (the cells), and the order the racks are left in.
  worth: (before, after) => after.score - before.score - SMASH_COST * (after.spills - before.spills) + order(after, true) - order(before, true),
  open: true,
  bots: [
    blindSorterBot(),
    hintBot(),
    plannerBot("planner", "Looks three actions ahead, sees the crate but not the next, calls when the racks are ready and counts the chain.", true),
    plannerBot("chain blind planner", "The planner, but every shipment is worth the same to it: it never plays for the chain.", false),
  ],
  slow: ["planner", "chain blind planner"],
};
