/**
 * A move log replayed from its seed under the server's rules (ADR 0003). The server holds every move
 * to the rules below as it arrives; the harness's review, the voyage bench's proof and the engine's
 * own tests replay a whole log through the same ones, so a log the server would refuse is refused
 * here at the same move for the same reason.
 *
 * Only the rules a log can be judged by alone live here. The ones that need the live round stay in
 * the server: a move's number in sequence, the moves only the server may vouch for (a ship's heat, a
 * battle's supply, a melee's incoming scrap and its won end), and a timed move's claim against the
 * wall clock.
 */
import type { PuzzleDef, PuzzleSummary } from "./def.js";
import { InvalidMoveError } from "./errors.js";

/**
 * Why the server refuses a round. The protocol's `puzzle.rejected` lists exactly these; the server
 * checks the two agree at compile time.
 */
export type RejectReason = "divergence" | "illegal_move" | "bad_sequence" | "deadline" | "too_many_moves";

/** When a move is judged: the round's length, how late a move is still taken, and when it arrived. */
export interface MoveClock {
  /** The round's length, in ms from its start. */
  readonly roundMs: number;
  /** How far past the round's end a move is still taken, for network latency. */
  readonly graceMs: number;
  /**
   * When the move arrived, in ms since the round started: the server's wall clock. A replay has no
   * arrival times and leaves it out; a timed move's claimed time (`moveTimeMs`) stands in, since a
   * client sends a move when it claims to make it. An untimed move with no arrival time is never late.
   */
  readonly atMs?: number;
}

/**
 * The server's rules for a move that need only the log and the round's clock, in the server's order:
 * a move after the round's end and its grace is late (`deadline`), and a move once the log holds the
 * most the engine allows is one too many (`too_many_moves`). `logged` is how many moves the log holds
 * before this one. Null when neither applies; the engine's own refusal and the hash are judged after.
 */
export function pureMoveRejection<S, M, C>(def: PuzzleDef<S, M, C>, config: C, logged: number, move: M, clock?: MoveClock): Extract<RejectReason, "deadline" | "too_many_moves"> | null {
  if (clock) {
    const at = clock.atMs ?? def.moveTimeMs?.(move, config);
    if (at !== undefined && at > clock.roundMs + clock.graceMs) return "deadline";
  }
  if (logged >= def.maxMoves(config)) return "too_many_moves";
  return null;
}

export interface ReplayOptions {
  /** The engine's hash after each move, as the client recorded it. Each one recorded is compared. */
  readonly hashes?: readonly (string | undefined)[];
  /**
   * The round's length. With it, a timed move claiming a time past the round's end is late. A replay
   * has no network, so it forgives no lateness. Without it, no move is late.
   */
  readonly roundMs?: number;
  /** Keep the state and hash after every move, for a reviewer to step through. */
  readonly keepStates?: boolean;
}

export interface ReplayStep<S, M> {
  readonly seq: number;
  readonly move: M;
  readonly state: S;
  readonly hash: string;
}

/** A move the server would refuse, other than for its hash. The replay stops before it. */
export interface ReplayRejection {
  readonly atSeq: number;
  readonly reason: Extract<RejectReason, "illegal_move" | "too_many_moves" | "deadline">;
  /** The engine's own words, for an illegal move. */
  readonly message?: string;
}

export interface Replay<S, M> {
  readonly initial: S;
  readonly initialHash: string;
  /** With `keepStates`, one entry per move applied, in order. Empty without it. */
  readonly steps: readonly ReplayStep<S, M>[];
  /** How many moves applied: the whole log, or the moves before `rejection`. */
  readonly applied: number;
  readonly final: S;
  readonly summary: PuzzleSummary;
  /** The first move the server would refuse by rule or the engine refuses, or null when every move applied. */
  readonly rejection: ReplayRejection | null;
  /**
   * The first move whose hash differs from the recorded one, or null. The server refuses the round
   * there (`divergence`), so when set it comes before any `rejection`. The replay walks on past it:
   * the engine can still apply the moves after it, and a reviewer can step through them.
   */
  readonly divergedAt: number | null;
}

/**
 * Replays `moves` from `seed` the way the server judges them as they arrive: each move is held to
 * the round's rules, then applied by the engine, then its hash compared with the recorded one. Pure:
 * the same inputs give the same replay on any machine.
 */
export function replayLog<S, M, C>(def: PuzzleDef<S, M, C>, seed: string, config: C, moves: readonly M[], opts: ReplayOptions = {}): Replay<S, M> {
  const initial = def.create(seed, config);
  const clock: MoveClock | undefined = opts.roundMs === undefined ? undefined : { roundMs: opts.roundMs, graceMs: 0 };
  const steps: ReplayStep<S, M>[] = [];
  let state = initial;
  let applied = 0;
  let rejection: ReplayRejection | null = null;
  let divergedAt: number | null = null;
  for (let seq = 0; seq < moves.length; seq++) {
    const move = moves[seq]!;
    const ruled = pureMoveRejection(def, config, seq, move, clock);
    if (ruled) {
      rejection = { atSeq: seq, reason: ruled };
      break;
    }
    try {
      state = def.reduce(state, move);
    } catch (e) {
      if (e instanceof InvalidMoveError) {
        rejection = { atSeq: seq, reason: "illegal_move", message: e.message };
        break;
      }
      throw e;
    }
    applied += 1;
    const recorded = opts.hashes?.[seq];
    if (recorded === undefined && !opts.keepStates) continue;
    const hash = def.hash(state);
    if (divergedAt === null && recorded !== undefined && recorded !== hash) divergedAt = seq;
    if (opts.keepStates) steps.push({ seq, move, state, hash });
  }
  return { initial, initialHash: def.hash(initial), steps, applied, final: state, summary: def.summarize(state), rejection, divergedAt };
}
