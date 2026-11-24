/**
 * The bot runner's core (ADR 0067): a round driven by a bot against a real engine, and the three
 * bots every puzzle gets. A puzzle is taught to the runner by a `BotGame`: what a player can do from
 * a state (its choices, each a short run of engine moves played as one), how much of the round a
 * state has used, and how a round is ended. Everything here is deterministic from the seeds it is
 * given, so a table printed twice is the same table.
 */
import { InvalidMoveError, nextInt, seedFromString, type PrngState, type PrototypePuzzleId, type PuzzleDef } from "@openseas/engine";

/** One thing a player can do: the engine moves it takes, played in order as one decision. */
export interface Choice<M> {
  readonly moves: readonly M[];
}

/** A small mutable random stream for a bot's own coin flips. Seeded, so a bot is deterministic too. */
export class Rng {
  private s: PrngState;
  constructor(seed: string) {
    this.s = seedFromString(seed);
  }
  /** Uniform in [0, n). */
  int(n: number): number {
    const r = nextInt(this.s, n);
    this.s = r.state;
    return r.value;
  }
  pick<T>(xs: readonly T[]): T {
    if (xs.length === 0) throw new Error("pick from nothing");
    return xs[this.int(xs.length)]!;
  }
}

/** What a bot is handed for each decision. */
export interface BotContext<S, M> {
  readonly game: AnyBotGame<S, M>;
  readonly roundSeconds: number;
  readonly rng: Rng;
  /** The state after a choice, or null when the round would be over before it lands. */
  apply(state: S, choice: Choice<M>): S | null;
  score(state: S): number;
}

export interface Bot<S, M> {
  /** One short word or phrase, the row's name in the table. */
  readonly name: string;
  /** One line: how it plays. Printed under the table. */
  readonly about: string;
  /** The next decision, or null to stop playing and let the round run out. */
  choose(state: S, ctx: BotContext<S, M>): Choice<M> | null;
}

/** A bait (ADR 0066 decision 6): a play that looks right and should lose to `beats` on the whole puzzle. */
export interface Bait {
  readonly bait: string;
  readonly beats: string;
}

export interface BotGame<S, M, C> {
  readonly id: PrototypePuzzleId;
  readonly def: PuzzleDef<S, M, C>;
  /** How a human's pace is modelled, in one line for the table: "45 hauls in 120 s". */
  readonly pace: string;
  /** Seconds of the round a state has used: moves times a human's pace, or the engine's own ticks. */
  elapsed(state: S): number;
  /** Every decision worth weighing from here. Empty when there is nothing to do but wait for the end. */
  choices(state: S): Choice<M>[];
  /** The move that ends the round at `roundSeconds`. */
  end(state: S, roundSeconds: number): M;
  /**
   * What a one-move bot weighs a choice by: by default the points it scores. A puzzle that pays
   * later than it is played (a tap that charges, a flip before a fire) says what a careful player
   * sees now.
   */
  worth?(before: S, after: S, choice: Choice<M>): number;
  /**
   * False when the state holds what the player cannot see (Scanner's contacts): a bot that tries a
   * move to see what it scores would be reading it, so the one-move and rollout bots are not run.
   */
  readonly open: boolean;
  /** The puzzle's own bots, beside the three every puzzle gets. */
  readonly bots?: readonly Bot<S, M>[];
  readonly baits?: readonly Bait[];
  /**
   * The bot that stands for plain thinking play in the careless check (rule 17): careless must land
   * a tier below it. When absent, the one-move bot for an open game and the first of the game's own
   * bots for a closed one. A puzzle where one move is not plain play names its own (Tug, where no
   * single flick pays, names a bot that sees two flicks ahead).
   */
  readonly plain?: string;
  /** Names of the puzzle's own bots that take seconds a round (they plan ahead): the tests play them less. */
  readonly slow?: readonly string[];
}

export type AnyBotGame<S = unknown, M = unknown> = BotGame<S, M, unknown>;

export function applyMoves<S, M>(def: PuzzleDef<S, M, unknown>, state: S, moves: readonly M[]): S {
  let s = state;
  for (const m of moves) s = def.reduce(s, m);
  return s;
}

function context<S, M>(game: AnyBotGame<S, M>, roundSeconds: number, rng: Rng): BotContext<S, M> {
  return {
    game,
    roundSeconds,
    rng,
    apply(state, choice) {
      let next: S;
      try {
        next = applyMoves(game.def, state, choice.moves);
      } catch (e) {
        if (e instanceof InvalidMoveError) throw new Error(`${game.id}: a choice the game offered was refused: ${e.message} (${JSON.stringify(choice.moves)})`);
        throw e;
      }
      return game.elapsed(next) > roundSeconds + 1e-9 ? null : next;
    },
    score: (state) => game.def.summarize(state).score,
  };
}

export interface RoundResult<S, M> {
  readonly score: number;
  readonly state: S;
  /** The whole move log, the end included: what the server would replay. */
  readonly log: readonly M[];
  readonly decisions: number;
}

/** One round of `bot` on `seed`: decisions until the round's clock runs out, then the end. */
export function playRound<S, M>(game: AnyBotGame<S, M>, bot: Bot<S, M>, seed: string, config: unknown, roundSeconds: number): RoundResult<S, M> {
  const def = game.def;
  const ctx = context(game, roundSeconds, new Rng(`bot:${bot.name}:${seed}`));
  let state = def.create(seed, config);
  const log: M[] = [];
  const limit = def.maxMoves(config) - 1;
  let decisions = 0;
  while (!def.isFinished(state)) {
    const choice = bot.choose(state, ctx);
    if (!choice || choice.moves.length === 0) break;
    const next = ctx.apply(state, choice);
    if (next === null || log.length + choice.moves.length > limit) break;
    if (game.elapsed(next) <= game.elapsed(state) && !def.isFinished(next) && choice.moves.length > 0) {
      // A choice that uses no time must still change something, or a bot could loop on it forever.
      if (def.hash(next) === def.hash(state)) throw new Error(`${game.id}: a choice changed nothing (${bot.name})`);
    }
    state = next;
    log.push(...choice.moves);
    decisions++;
  }
  if (!def.isFinished(state)) {
    const end = game.end(state, roundSeconds);
    state = def.reduce(state, end);
    log.push(end);
  }
  return { score: def.summarize(state).score, state, log, decisions };
}

/** Every choice from `state` that lands inside the round, with what it leaves and its worth to a one-move bot. */
export function weigh<S, M>(state: S, ctx: BotContext<S, M>): Array<{ choice: Choice<M>; after: S; worth: number }> {
  const game = ctx.game;
  const before = ctx.score(state);
  const out: Array<{ choice: Choice<M>; after: S; worth: number }> = [];
  for (const choice of game.choices(state)) {
    const after = ctx.apply(state, choice);
    if (after === null) continue;
    const worth = game.worth ? game.worth(state, after, choice) : ctx.score(after) - before;
    out.push({ choice, after, worth });
  }
  return out;
}

/** The best of `weighed` by worth, ties broken by the bot's own stream. */
function best<T extends { worth: number }>(weighed: readonly T[], rng: Rng): T | null {
  if (weighed.length === 0) return null;
  let top = -Infinity;
  for (const w of weighed) if (w.worth > top) top = w.worth;
  return rng.pick(weighed.filter((w) => w.worth === top));
}

/** Careless: any choice the game offers, at random. Stands in for spam, the floor every tier sits on. */
export function carelessBot<S, M>(): Bot<S, M> {
  return {
    name: "careless",
    about: "Takes any choice at random.",
    choose(state, ctx) {
      const options = ctx.game.choices(state);
      return options.length ? ctx.rng.pick(options) : null;
    },
  };
}

/** One move: the choice worth most now, as the puzzle weighs it. Sees the whole board and nothing ahead. */
export function oneMoveBot<S, M>(): Bot<S, M> {
  return {
    name: "one move",
    about: "Takes the choice worth most now and looks no further.",
    choose(state, ctx) {
      return best(weigh(state, ctx), ctx.rng)?.choice ?? null;
    },
  };
}

export interface RolloutOptions {
  /** How many of the one-move bot's best choices are tried. */
  readonly width: number;
  /** How many times each is played on. */
  readonly tries: number;
  /** How many decisions each try plays on, by the one-move bot. */
  readonly depth: number;
}

export const DEFAULT_ROLLOUT: RolloutOptions = { width: 8, tries: 3, depth: 5 };

/**
 * A state with its random stream replaced: what comes next is drawn afresh, so a bot that plays on
 * from it learns nothing of what the real stream will deal. Every engine keeps its stream as `rng`.
 */
export function reseed<S>(state: S, seed: string): S {
  if (typeof state !== "object" || state === null || !("rng" in state)) throw new Error("a state with no rng cannot be reseeded");
  return { ...state, rng: seedFromString(seed) };
}

/**
 * Rollout: the one-move bot's best few choices, each played on a few decisions by the one-move bot
 * on a fresh random stream, several times; the one that ends best on average is taken. It plans,
 * and it never sees what will drift in.
 */
export function rolloutBot<S, M>(options: RolloutOptions = DEFAULT_ROLLOUT, name = "rollout", inner: Bot<S, M> = oneMoveBot<S, M>()): Bot<S, M> {
  return {
    name,
    about: `Tries the ${options.width} best choices, each played on ${options.depth} decisions ${options.tries} times on a fresh random stream, and takes the best on average.`,
    choose(state, ctx) {
      const weighed = weigh(state, ctx).sort((a, b) => b.worth - a.worth);
      if (weighed.length === 0) return null;
      const start = ctx.score(state);
      let bestChoice = weighed[0]!.choice;
      let bestValue = -Infinity;
      for (const w of weighed.slice(0, options.width)) {
        let total = 0;
        for (let t = 0; t < options.tries; t++) {
          let s = reseed(w.after, `rollout:${ctx.rng.int(0x7fffffff)}`);
          for (let d = 0; d < options.depth && !ctx.game.def.isFinished(s); d++) {
            const c = inner.choose(s, ctx);
            if (!c) break;
            const next = ctx.apply(s, c);
            if (next === null) break;
            s = next;
          }
          total += ctx.score(s) - start;
        }
        // Compare on the total; ties keep the one the one-move bot ranked first.
        if (total > bestValue) {
          bestValue = total;
          bestChoice = w.choice;
        }
      }
      return bestChoice;
    },
  };
}

/** The bots a ladder runs for a puzzle: careless, one move and rollout where the game is open, then its own. */
/** The name of the bot the careless check compares against: the game's own pick, or the default. */
export function plainBotName<S, M>(game: AnyBotGame<S, M>): string | null {
  return game.plain ?? (game.open ? "one move" : (game.bots?.[0]?.name ?? null));
}

export function botsFor<S, M>(game: AnyBotGame<S, M>): Bot<S, M>[] {
  const generic: Bot<S, M>[] = game.open ? [carelessBot(), oneMoveBot(), rolloutBot()] : [carelessBot()];
  return [...generic, ...(game.bots ?? [])];
}
