/**
 * Pouring for the bots: a choice is one turn, a pour of a hand slot on a square or a drink downed.
 * The rivals play inside the engine, so every bot here plays against the same table of rivals.
 */
import {
  POURING_DEF,
  pouringBestPour,
  pouringLegalCells,
  pouringPourValue,
  pouringSlotValue,
  type PouringConfig,
  type PouringMove,
  type PouringState,
} from "@openseas/engine";
import { type Bot, type BotGame, type Choice } from "../core.js";

/** A person's pace, from the tuning notes: a turn every 6 seconds, the rivals' turns played back included. */
const SECONDS_PER_TURN = 6;

function pours(state: PouringState): PouringMove[] {
  const out: PouringMove[] = [];
  state.seats[0]!.hand.forEach((_, slot) => {
    for (const cell of pouringLegalCells(state, slot)) out.push({ type: "pour", slot, cell });
  });
  return out;
}

function drinks(state: PouringState): PouringMove[] {
  return state.seats[0]!.hand.map((_, slot): PouringMove => ({ type: "drink", slot }));
}

/** The drink worth most in hand, to down when nothing fits. */
function bestDrink(state: PouringState): PouringMove {
  let slot = 0;
  let top = -1;
  state.seats[0]!.hand.forEach((s, i) => {
    const v = pouringSlotValue(state.config, s);
    if (v > top) {
      top = v;
      slot = i;
    }
  });
  return { type: "drink", slot };
}

/** A beginner: any pour that fits, at random; a drink only when nothing does. */
function anyFitBot(): Bot<PouringState, PouringMove> {
  return {
    name: "any fit",
    about: "Pours anything that fits, anywhere, at random; drinks only when nothing fits.",
    choose(state, ctx) {
      const options = pours(state).filter((m) => m.type === "pour" && state.seats[0]!.hand[m.slot]!.piece.kind !== "rag");
      return { moves: [options.length ? ctx.rng.pick(options) : bestDrink(state)] };
    },
  };
}

/** The careful rating the rivals play by, every turn: points now, less a share of a line for every gap it hands the next pirate. */
function carefulBot(): Bot<PouringState, PouringMove> {
  return {
    name: "careful",
    about: "Every turn, the pour the rivals' rating likes best: points now, less 60% of a line for each gap left for the next pirate.",
    choose(state) {
      const b = pouringBestPour(state, 0);
      return { moves: [b ? { type: "pour", slot: b.slot, cell: b.cell } : bestDrink(state)] };
    },
  };
}

/** The bait: drink whenever a drink is worth more than the best pour on offer. Aged drinks look like free points. */
function toperBot(): Bot<PouringState, PouringMove> {
  return {
    name: "toper",
    about: "The careful bot, but downs a drink whenever it is worth more than the best pour's points (the bait).",
    choose(state) {
      const b = pouringBestPour(state, 0);
      const d = bestDrink(state);
      const dv = d.type === "drink" ? pouringSlotValue(state.config, state.seats[0]!.hand[d.slot]!) : 0;
      if (!b || dv > pouringPourValue(state, b.slot, b.cell).points) return { moves: [d] };
      return { moves: [{ type: "pour", slot: b.slot, cell: b.cell }] };
    },
  };
}

export const POURING_BOTS: BotGame<PouringState, PouringMove, PouringConfig> = {
  id: "pouring",
  def: POURING_DEF,
  pace: "a turn every 6 s",
  elapsed: (s) => s.moveCount * SECONDS_PER_TURN,
  choices: (s): Choice<PouringMove>[] => [...pours(s), ...drinks(s)].map((m) => ({ moves: [m] })),
  end: () => ({ type: "end" }),
  open: true,
  bots: [anyFitBot(), carefulBot(), toperBot()],
  baits: [
    { bait: "toper", beats: "careful" },
    { bait: "one move", beats: "careful" },
  ],
};
