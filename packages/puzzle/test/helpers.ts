import { nextBelow, streamFrom, swapEngine, type Engine, type Entry, type Log, type Move, type Round, type RoundEvent, type Scale, type SettingValue, type SwapState } from "../src/index.js";

/** A host's scale, as the game's is: Steady from 1300, a tier every 300. */
export const SCALE: Scale = { floor: 1000, steady: 1300, sharp: 1600, masterful: 1900, legendary: 2200, ceiling: 2500 };

export const swap = swapEngine({ scale: SCALE });

/** Every swap a board allows, each pair once: a piece and the neighbour on its right. */
export function swaps(round: Round<SwapState>): Move[] {
  const { width, height } = round.board;
  const out: Move[] = [];
  for (let r = 0; r < height; r++) for (let c = 0; c < width - 1; c++) out.push({ id: "swap", at: r * width + c, to: "right" });
  return out;
}

export interface Plan {
  readonly seed: string;
  readonly stage?: string;
  readonly values?: Readonly<Record<string, SettingValue>>;
  /** Milliseconds between swaps. */
  readonly every: number;
  /** `greedy` takes the swap worth most now; `careless` takes any. */
  readonly how: "greedy" | "careless";
  /** `level` signals to put in the log, by time. */
  readonly levels?: readonly (readonly [at: number, rows: number])[];
}

export interface Ran {
  readonly round: Round<SwapState>;
  readonly log: Log;
  readonly events: readonly (readonly RoundEvent[])[];
  readonly layers: readonly string[];
  readonly settings: Readonly<Record<string, SettingValue>>;
}

/** Plays a whole round by a plan, to the end of its clock. */
export function run(engine: Engine<SwapState>, plan: Plan): Ran {
  const settings = engine.settings({ stage: plan.stage ?? "full", ...(plan.values ? { values: plan.values } : {}) });
  let round = engine.start(plan.seed, settings);
  const end = (settings.values["roundSeconds"] as number) * 1000;
  let luck = streamFrom(`plan:${plan.seed}`);
  const entries: Entry[] = [];
  const events: (readonly RoundEvent[])[] = [];
  const levels = [...(plan.levels ?? [])];
  const take = (entry: Entry): void => {
    const played = engine.play(round, entry);
    round = played.round;
    entries.push(entry);
    events.push(played.events);
  };
  for (let at = plan.every; at < end; at += plan.every) {
    while (levels.length > 0 && levels[0]![0] <= at) {
      const [when, rows] = levels.shift()!;
      take({ at: when, signal: { id: "level", value: rows } });
    }
    const all = swaps(round);
    // Any swap, which is also what the greedy plan makes when no swap scores: a board can have none.
    const [any, after] = nextBelow(luck, all.length);
    luck = after;
    let move = all[any]!;
    if (plan.how === "greedy") {
      let best = 0;
      for (const m of all) {
        const points = engine.play(round, { at, move: m }).round.score - round.score;
        if (points > best) {
          best = points;
          move = m;
        }
      }
    }
    take({ at, move });
  }
  const closed = engine.mark(round, end);
  events.push(closed.events);
  return { round: closed.round, log: { entries, end }, events, layers: settings.layers, settings: settings.values };
}
