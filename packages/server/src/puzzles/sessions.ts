import {
  InvalidMoveError,
  createBilgingGame,
  hashBilgingState,
  reduceBilging,
  summarizeBilging,
  type BilgingConfig,
  type BilgingMove,
  type BilgingState,
  type BilgingSummary,
  type PuzzleId,
} from "@openseas/engine";
import type { BilgingConfigWire, BilgingMoveWire } from "@openseas/protocol";

// The wire shapes must be assignable to the engine's. If this stops compiling, protocol and engine drifted.
const _moveCheck: (m: BilgingMoveWire) => BilgingMove = (m) => m;
const _configCheck: (c: BilgingConfigWire) => BilgingConfig = (c) => c;
void _moveCheck;
void _configCheck;

export type RejectReason = "divergence" | "illegal_move" | "bad_sequence" | "deadline" | "too_many_moves";

export interface PuzzleSession {
  readonly id: string;
  readonly pirateId: string;
  readonly puzzle: PuzzleId;
  readonly seed: string;
  readonly config: BilgingConfig;
  readonly startedAt: number;
  readonly deadlineAt: number;
  state: BilgingState;
  moves: BilgingMove[];
  closed: boolean;
}

export type MoveOutcome = { ok: true; seq: number } | { ok: false; reason: RejectReason; atSeq: number };

export type FinishOutcome =
  | { ok: true; state: BilgingState; summary: BilgingSummary; moves: readonly BilgingMove[] }
  | { ok: false; reason: RejectReason };

export interface SessionManagerOptions {
  /** Grace after the deadline during which late moves are still accepted, for network latency. */
  graceMs: number;
  roundMs: number;
  config: BilgingConfig;
  now: () => number;
  randomSeed: () => string;
  randomId: () => string;
}

/**
 * Authoritative puzzle sessions (ADR 0003). Replays each client move as it arrives and rejects the
 * round on the first divergence, illegal move, or sequencing error. Holds no I/O: the service layer
 * persists outcomes.
 */
export class PuzzleSessionManager {
  private readonly sessions = new Map<string, PuzzleSession>();

  constructor(private readonly opts: SessionManagerOptions) {}

  start(pirateId: string, puzzle: PuzzleId): PuzzleSession {
    const now = this.opts.now();
    const seed = this.opts.randomSeed();
    const session: PuzzleSession = {
      id: this.opts.randomId(),
      pirateId,
      puzzle,
      seed,
      config: this.opts.config,
      startedAt: now,
      deadlineAt: now + this.opts.roundMs,
      state: createBilgingGame(seed, this.opts.config),
      moves: [],
      closed: false,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): PuzzleSession | undefined {
    return this.sessions.get(id);
  }

  move(session: PuzzleSession, seq: number, move: BilgingMove, hash: string): MoveOutcome {
    if (session.closed) return { ok: false, reason: "deadline", atSeq: seq };
    if (seq !== session.moves.length) return this.reject(session, "bad_sequence", seq);
    if (this.opts.now() > session.deadlineAt + this.opts.graceMs) return this.reject(session, "deadline", seq);
    if (session.moves.length >= session.config.maxMoves) return this.reject(session, "too_many_moves", seq);
    let next: BilgingState;
    try {
      next = reduceBilging(session.state, move);
    } catch (e) {
      if (e instanceof InvalidMoveError) return this.reject(session, "illegal_move", seq);
      throw e;
    }
    if (hashBilgingState(next) !== hash) return this.reject(session, "divergence", seq);
    session.state = next;
    session.moves.push(move);
    return { ok: true, seq };
  }

  finish(session: PuzzleSession, hash: string | null): FinishOutcome {
    if (session.closed) return { ok: false, reason: "deadline" };
    if (hash !== null && hashBilgingState(session.state) !== hash) {
      this.close(session);
      return { ok: false, reason: "divergence" };
    }
    this.close(session);
    return { ok: true, state: session.state, summary: summarizeBilging(session.state), moves: session.moves };
  }

  close(session: PuzzleSession): void {
    session.closed = true;
    this.sessions.delete(session.id);
  }

  /** Sessions past their deadline and grace. The caller decides whether to score them. */
  expired(): PuzzleSession[] {
    const now = this.opts.now();
    const out: PuzzleSession[] = [];
    for (const s of this.sessions.values()) if (now > s.deadlineAt + this.opts.graceMs) out.push(s);
    return out;
  }

  get size(): number {
    return this.sessions.size;
  }

  private reject(session: PuzzleSession, reason: RejectReason, atSeq: number): MoveOutcome {
    this.close(session);
    return { ok: false, reason, atSeq };
  }
}
