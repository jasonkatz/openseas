import { InvalidMoveError, type PuzzleDef } from "@openseas/engine";

export interface ReplayStep<S, M> {
  readonly seq: number;
  readonly move: M;
  readonly state: S;
  readonly hash: string;
}

export interface Replay<S, M> {
  readonly initial: S;
  readonly initialHash: string;
  /** One entry per move that applied; shorter than the log when `error` is set. */
  readonly steps: readonly ReplayStep<S, M>[];
  /** The first move the engine refused, if any. */
  readonly error: { readonly atSeq: number; readonly message: string } | null;
  /** Where the engine's hashes stopped agreeing with the recorded ones, if hashes were recorded. */
  readonly divergedAt: number | null;
  readonly final: S;
  readonly summary: { readonly score: number; readonly moves: number; readonly bestCombo: number };
}

/**
 * Replays a move log from its seed the way the server does (ADR 0003), keeping every state so a
 * reviewer can step through them, and compares each hash with what was recorded. Pure: the same
 * inputs give the same replay on any machine, which is the property the harness exists to check.
 */
export function replayRound<S, M, C>(def: PuzzleDef<S, M, C>, seed: string, config: C, moves: readonly M[], recordedHashes?: readonly string[]): Replay<S, M> {
  const initial = def.create(seed, config);
  const steps: ReplayStep<S, M>[] = [];
  let state = initial;
  let error: Replay<S, M>["error"] = null;
  let divergedAt: number | null = null;
  for (let seq = 0; seq < moves.length; seq++) {
    const move = moves[seq]!;
    try {
      state = def.reduce(state, move);
    } catch (e) {
      if (e instanceof InvalidMoveError) {
        error = { atSeq: seq, message: e.message };
        break;
      }
      throw e;
    }
    const hash = def.hash(state);
    if (recordedHashes && divergedAt === null && recordedHashes[seq] !== undefined && recordedHashes[seq] !== hash) divergedAt = seq;
    steps.push({ seq, move, state, hash });
  }
  return { initial, initialHash: def.hash(initial), steps, error, divergedAt, final: state, summary: def.summarize(state) };
}

/**
 * Whether a replay agrees with the round it replays: the whole log applied, and every hash the
 * round made came out again. The studio asks this of every round it plays and speaks only when
 * the answer is no (ADR 0042 decision 3).
 */
export function replayAgrees<S, M>(replay: Replay<S, M>): boolean {
  return replay.error === null && replay.divergedAt === null;
}

/** Finds a seed whose opening state satisfies `probe`, trying `prefix-1`, `prefix-2`, ... up to `tries`. */
export function findSeed<S, M, C>(def: PuzzleDef<S, M, C>, config: C, probe: (state: S) => boolean, prefix: string, tries = 5000): string | null {
  for (let i = 1; i <= tries; i++) {
    const seed = `${prefix}-${i}`;
    if (probe(def.create(seed, config))) return seed;
  }
  return null;
}
