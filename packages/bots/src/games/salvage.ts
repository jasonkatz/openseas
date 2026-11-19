/**
 * Salvage for the bots: a choice is one line, open or closed into a net. Lines are found by a
 * bounded depth-first search from every piece, the way the engine's own hint looks, and the
 * runner keeps the most valuable and a handful of short ones (a careless player draws those).
 */
import {
  SALVAGE_CRATE,
  SALVAGE_DEF,
  salvageAdjacent,
  salvageCanClose,
  salvageCanLink,
  salvageIsVolatile,
  salvageLineValue,
  salvageTetherable,
  type SalvageConfig,
  type SalvageMove,
  type SalvageState,
} from "@openseas/engine";
import { oneMoveBot, rolloutBot, type Bot, type BotGame, type Choice } from "../core.js";

/** A person's pace, from the tuning notes: 45 hauls in a 120 second round. */
const SECONDS_PER_HAUL = 120 / 45;
/** Search steps from each piece. */
const STEPS_PER_START = 120;
/** The most valuable lines kept, and the short ones beside them. */
const KEEP_BEST = 20;
const KEEP_SHORT = 12;

type Line = Extract<SalvageMove, { type: "tether" }>;

function neighbours(cfg: SalvageConfig, cell: number): number[] {
  const out: number[] = [];
  for (let other = 0; other < cfg.width * cfg.height; other++) if (other !== cell && salvageAdjacent(cfg, cell, other)) out.push(other);
  return out;
}

const neighbourCache = new Map<string, number[][]>();
function neighbourTable(cfg: SalvageConfig): number[][] {
  const key = `${cfg.width}x${cfg.height}`;
  let table = neighbourCache.get(key);
  if (!table) {
    table = [];
    for (let c = 0; c < cfg.width * cfg.height; c++) table.push(neighbours(cfg, c));
    neighbourCache.set(key, table);
  }
  return table;
}

/** Lines on the field: every one the search reaches, each kept once, nets beside open lines. */
export function salvageLines(state: SalvageState): Line[] {
  const cfg = state.config;
  const near = neighbourTable(cfg);
  const found = new Map<string, Line>();
  const path: number[] = [];
  const record = (loop: boolean): void => {
    const key = `${loop ? "L" : "O"}${[...path].sort((a, b) => a - b).join(",")}`;
    if (!found.has(key)) found.set(key, { type: "tether", cells: path.slice(), loop });
  };
  for (let start = 0; start < state.cells.length; start++) {
    if (!salvageTetherable(state.cells[start]!)) continue;
    let budget = STEPS_PER_START;
    const walk = (cell: number): void => {
      path.push(cell);
      if (path.length >= cfg.minLine) record(false);
      if (path.length >= cfg.loopMin && salvageCanClose(state, path)) record(true);
      for (const next of near[cell]!) {
        if (budget <= 0) break;
        if (path.includes(next) || !salvageCanLink(state.cells[cell]!, state.cells[next]!)) continue;
        budget--;
        walk(next);
      }
      path.pop();
    };
    walk(start);
  }
  const all = [...found.values()];
  const valued = all.map((line) => ({ line, value: salvageLineValue(state, line.cells, line.loop).base }));
  valued.sort((a, b) => b.value - a.value || b.line.cells.length - a.line.cells.length);
  const best = valued.slice(0, KEEP_BEST).map((v) => v.line);
  const short = all.filter((l) => !l.loop && l.cells.length <= cfg.minLine + 1);
  const step = Math.max(1, Math.floor(short.length / KEEP_SHORT));
  const shortKept: Line[] = [];
  for (let i = 0; i < short.length && shortKept.length < KEEP_SHORT; i += step) shortKept.push(short[i]!);
  const keys = new Set(best.map((l) => `${l.loop}${l.cells.join(",")}`));
  return [...best, ...shortKept.filter((l) => !keys.has(`${l.loop}${l.cells.join(",")}`))];
}

const crates = (state: SalvageState): number => state.cells.filter((p) => p.kind === SALVAGE_CRATE).length;
const volatileOnField = (state: SalvageState): boolean => state.cells.some((p) => salvageIsVolatile(p));

/**
 * The tuning notes' patient netter: blind to orders and volatiles, it hauls the longest line it
 * finds and closes a net only when every crate the field can hold is adrift.
 */
function netterBot(): Bot<SalvageState, SalvageMove> {
  return {
    name: "patient netter",
    about: "Blind to orders and volatiles: the longest open line, and a net only when the field holds its most crates.",
    choose(state, ctx) {
      const lines = salvageLines(state);
      if (lines.length === 0) return null;
      const full = crates(state) >= Math.max(1, state.config.maxCrates);
      const nets = lines.filter((l) => l.loop);
      if (full && nets.length) return { moves: [ctx.rng.pick(nets)] };
      let longest = 0;
      for (const l of lines) if (!l.loop) longest = Math.max(longest, l.cells.length);
      const open = lines.filter((l) => !l.loop && l.cells.length === longest);
      return open.length ? { moves: [ctx.rng.pick(open)] } : { moves: [ctx.rng.pick(lines)] };
    },
  };
}

/** The bait: the rollout bot, made to defuse a volatile the moment it can reach one. */
function defuseAtOnceBot(): Bot<SalvageState, SalvageMove> {
  const rollout = rolloutBot<SalvageState, SalvageMove>(undefined, "defuse at once");
  return {
    name: "defuse at once",
    about: "The rollout bot, but a volatile on the field is defused by the first line that can reach it (the bait).",
    choose(state, ctx) {
      if (volatileOnField(state)) {
        const defusing = salvageLines(state).filter((l) => salvageLineValue(state, l.cells, l.loop).defused.length > 0);
        if (defusing.length) {
          // Of the lines that defuse, the one a one-move player would take.
          const one = oneMoveBot<SalvageState, SalvageMove>();
          const narrowed = { ...ctx, game: { ...ctx.game, choices: () => defusing.map((l) => ({ moves: [l] })) } };
          return one.choose(state, narrowed);
        }
      }
      return rollout.choose(state, ctx);
    },
  };
}

export const SALVAGE_BOTS: BotGame<SalvageState, SalvageMove, SalvageConfig> = {
  id: "salvage",
  def: SALVAGE_DEF,
  pace: "45 hauls in 120 s",
  elapsed: (s) => s.moveCount * SECONDS_PER_HAUL,
  choices: (s): Choice<SalvageMove>[] => salvageLines(s).map((l) => ({ moves: [l] })),
  end: () => ({ type: "end" }),
  open: true,
  bots: [netterBot(), defuseAtOnceBot()],
  slow: ["defuse at once"],
  baits: [{ bait: "defuse at once", beats: "rollout" }],
};
