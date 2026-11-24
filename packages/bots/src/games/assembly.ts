/**
 * Assembly for the bots: a choice is one swap or one fit. Every legal swap and fit is a choice, so
 * a careless player moves parts blind; the one-move bot fits whatever fits now, and otherwise takes
 * the swap that opens the most.
 */
import {
  ASSEMBLY_CORE,
  ASSEMBLY_DEF,
  assemblyCoverCells,
  assemblyLegalFits,
  assemblyLegalSwaps,
  seedFromString,
  type AssemblyConfig,
  type AssemblyMove,
  type AssemblyState,
} from "@openseas/engine";
import type { Bot, BotGame, Choice } from "../core.js";

/** A person's pace, from the tuning notes: a swap takes 1.2 seconds, a fit 2 (pick the blueprint, then where it goes). */
const SECONDS_PER_SWAP = 1.2;
const SECONDS_PER_FIT = 2;

function moves(state: AssemblyState): AssemblyMove[] {
  const out: AssemblyMove[] = [];
  for (const f of assemblyLegalFits(state)) out.push({ type: "fit", slot: f.slot, cell: f.cell });
  for (const s of assemblyLegalSwaps(state)) out.push({ type: "swap", a: s.a, b: s.b });
  return out;
}

const apply = (state: AssemblyState, m: AssemblyMove): AssemblyState => ASSEMBLY_DEF.reduce(state, m);

/** Blueprints in the tray that fit somewhere now. */
function readySlots(state: AssemblyState): number {
  return new Set(assemblyLegalFits(state).map((f) => f.slot)).size;
}

/** Blueprint placings one part short: how close the bay is to the next fit. */
function nearFits(state: AssemblyState): number {
  const cfg = state.config;
  let n = 0;
  for (const bp of state.tray) {
    for (let r = 0; r + bp.height <= cfg.height; r++) {
      for (let c = 0; c + bp.width <= cfg.width; c++) {
        const cover = assemblyCoverCells(cfg, bp, r * cfg.width + c)!;
        let miss = 0;
        for (let i = 0; i < cover.length && miss < 2; i++) {
          const p = state.cells[cover[i]!]!;
          if (p.kind !== ASSEMBLY_CORE && p.kind !== bp.parts[i]!.kind) miss++;
        }
        if (miss === 1) n++;
      }
    }
  }
  return n;
}

/** How well a bay is set up: blueprints ready first, then placings one part short. */
const setup = (state: AssemblyState): number => readySlots(state) * 1000 + nearFits(state);

/** The swap that sets the bay up best, ties broken at random. */
function bestSwap(state: AssemblyState, rng: { pick<T>(xs: readonly T[]): T }): { move: AssemblyMove; value: number } | null {
  let top = -Infinity;
  let best: AssemblyMove[] = [];
  for (const s of assemblyLegalSwaps(state)) {
    const m: AssemblyMove = { type: "swap", a: s.a, b: s.b };
    const v = setup(apply(state, m));
    if (v > top) {
      top = v;
      best = [m];
    } else if (v === top) best.push(m);
  }
  return best.length ? { move: rng.pick(best), value: top } : null;
}

/** The fit that leaves the most blueprints still ready, then scores most. */
function bestFit(state: AssemblyState): AssemblyMove | null {
  let best: AssemblyMove | null = null;
  let top = -Infinity;
  for (const f of assemblyLegalFits(state)) {
    const m: AssemblyMove = { type: "fit", slot: f.slot, cell: f.cell };
    const after = apply(state, m);
    const v = readySlots(after) * 100_000 + (after.score - state.score);
    if (v > top) {
      top = v;
      best = m;
    }
  }
  return best;
}

/** The bait: fit anything the moment it fits, and swap only to open a fit. It looks like steady work and never chains on purpose. */
function fitAtOnceBot(): Bot<AssemblyState, AssemblyMove> {
  return {
    name: "fit at once",
    about: "Fits a blueprint the moment one fits, the one worth most; otherwise the swap that sets the bay up best (the bait).",
    choose(state, ctx) {
      const fit = bestFit(state);
      if (fit) return { moves: [fit] };
      const s = bestSwap(state, ctx.rng);
      return s ? { moves: [s.move] } : null;
    },
  };
}

/**
 * The chain builder: swaps while a swap readies another blueprint, then fits every ready one in a
 * chain, the one that leaves the most others ready first. It is the compound move as a rule.
 */
function chainBuilderBot(minReady = 1): Bot<AssemblyState, AssemblyMove> {
  return {
    name: minReady > 1 ? `builder of ${minReady}` : "chain builder",
    about:
      minReady > 1
        ? `The chain builder, but it starts a chain only once ${minReady} blueprints are ready, if a swap can still ready one.`
        : "Swaps while a swap readies another blueprint, then fits every ready one in a chain, keeping the rest ready.",
    choose(state, ctx) {
      const fit = bestFit(state);
      // Inside a chain, keep fitting: a swap would end it.
      if (state.chain > 0 && fit) return { moves: [fit] };
      const ready = readySlots(state);
      const s = bestSwap(state, ctx.rng);
      if (s && Math.floor(s.value / 1000) > ready) return { moves: [s.move] };
      if (fit && ready >= Math.min(minReady, state.tray.length)) return { moves: [fit] };
      if (fit && (!s || Math.floor(s.value / 1000) <= ready) && ready > 0 && minReady > 1) return { moves: [fit] };
      if (s) return { moves: [s.move] };
      return fit ? { moves: [fit] } : null;
    },
  };
}

export const ASSEMBLY_BOTS: BotGame<AssemblyState, AssemblyMove, AssemblyConfig> = {
  id: "assembly",
  def: ASSEMBLY_DEF,
  pace: "a swap every 1.2 s, a fit every 2 s",
  elapsed: (s) => s.swaps * SECONDS_PER_SWAP + s.fits * SECONDS_PER_FIT,
  choices: (s): Choice<AssemblyMove>[] => moves(s).map((m) => ({ moves: [m] })),
  end: () => ({ type: "end" }),
  // A swap scores nothing, but a careful player sees the fits it readies.
  worth: (before, after) => after.score - before.score + (after.lastMove?.swap ? setup(after) / 1000 - setup(before) / 1000 : 0),
  open: true,
  bots: [fitAtOnceBot(), chainBuilderBot(), chainBuilderBot(3)],
  slow: [],
  baits: [{ bait: "fit at once", beats: "chain builder" }],
  reseed: (s, seed) => ({
    ...s,
    streams: {
      parts: seedFromString(`${seed}:parts`),
      cores: seedFromString(`${seed}:cores`),
      prints: seedFromString(`${seed}:prints`),
    },
  }),
};
