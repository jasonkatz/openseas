import { InvalidMoveError, PUZZLES, type AnyPuzzleDef, type PuzzleId, type PuzzleSummary } from "@openseas/engine";

export type RejectReason = "divergence" | "illegal_move" | "bad_sequence" | "deadline" | "too_many_moves";

/** A round played at a ship's station rather than on a practice page. */
export interface DutyBinding {
  readonly shipId: string;
  readonly station: PuzzleId;
  readonly voyageId: string;
  /** Bilging only: the ship's bilge in rows when the board is dealt. */
  readonly water?: number;
}

function isWaterMove(move: unknown): move is { type: "water"; row: number } {
  return typeof move === "object" && move !== null && (move as { type?: unknown }).type === "water";
}

export interface PuzzleSession {
  readonly id: string;
  readonly pirateId: string;
  readonly puzzle: PuzzleId;
  readonly def: AnyPuzzleDef;
  readonly seed: string;
  readonly config: unknown;
  readonly startedAt: number;
  readonly deadlineAt: number;
  /** Set when the board belongs to a ship; its points feed the ship each turn. */
  readonly duty: DutyBinding | null;
  /** Bilging duty only: the ship's bilge in rows as last told to the client. A water move must say this. */
  shipWaterRow: number | null;
  state: unknown;
  moves: unknown[];
  closed: boolean;
}

export type MoveOutcome = { ok: true; seq: number } | { ok: false; reason: RejectReason; atSeq: number };

export type FinishOutcome =
  | { ok: true; state: unknown; summary: PuzzleSummary; moves: readonly unknown[] }
  | { ok: false; reason: RejectReason };

export interface PuzzleRoundOptions {
  roundMs: number;
  config: unknown;
}

export interface SessionManagerOptions {
  /** Grace after the deadline during which late moves are still accepted, for network latency. */
  graceMs: number;
  /** Round length and engine config per puzzle, from content. */
  puzzles: Readonly<Record<PuzzleId, PuzzleRoundOptions>>;
  now: () => number;
  randomSeed: () => string;
  randomId: () => string;
}

/**
 * Authoritative puzzle sessions (ADR 0003) for every engine in the registry. Replays each client
 * move as it arrives and rejects the round on the first divergence, illegal move, or sequencing
 * error. Holds no I/O: the service layer persists outcomes.
 */
export class PuzzleSessionManager {
  private readonly sessions = new Map<string, PuzzleSession>();

  constructor(private readonly opts: SessionManagerOptions) {
    for (const id of Object.keys(opts.puzzles) as PuzzleId[]) PUZZLES[id].validateConfig(opts.puzzles[id].config);
  }

  start(pirateId: string, puzzle: PuzzleId, duty: DutyBinding | null = null): PuzzleSession {
    const now = this.opts.now();
    const seed = this.opts.randomSeed();
    const def = PUZZLES[puzzle];
    const { roundMs, config: content } = this.opts.puzzles[puzzle];
    // Aboard a ship the Bilging board's water is the ship's bilge (DESIGN.md 3.3).
    const config = duty && puzzle === "bilging" ? { ...(content as object), shipWater: true } : content;
    const session: PuzzleSession = {
      id: this.opts.randomId(),
      pirateId,
      puzzle,
      def,
      seed,
      config,
      startedAt: now,
      deadlineAt: now + roundMs,
      duty,
      shipWaterRow: duty?.water ?? null,
      state: def.create(seed, config),
      moves: [],
      closed: false,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): PuzzleSession | undefined {
    return this.sessions.get(id);
  }

  /** `move` must already be validated against the session's puzzle schema. */
  move(session: PuzzleSession, seq: number, move: unknown, hash: string): MoveOutcome {
    if (session.closed) return { ok: false, reason: "deadline", atSeq: seq };
    if (seq !== session.moves.length) return this.reject(session, "bad_sequence", seq);
    const now = this.opts.now();
    if (now > session.deadlineAt + this.opts.graceMs) return this.reject(session, "deadline", seq);
    if (session.moves.length >= session.def.maxMoves(session.config)) return this.reject(session, "too_many_moves", seq);
    // A water event is the ship's word, not the client's: it must repeat what the ship said.
    if (isWaterMove(move) && move.row !== session.shipWaterRow) return this.reject(session, "illegal_move", seq);
    // Engines with their own clock may not claim a time ahead of the wall clock.
    const claimed = session.def.moveTimeMs?.(move, session.config);
    if (claimed !== undefined && session.startedAt + claimed > now + this.opts.graceMs) return this.reject(session, "illegal_move", seq);
    let next: unknown;
    try {
      next = session.def.reduce(session.state, move);
    } catch (e) {
      if (e instanceof InvalidMoveError) return this.reject(session, "illegal_move", seq);
      throw e;
    }
    if (session.def.hash(next) !== hash) return this.reject(session, "divergence", seq);
    session.state = next;
    session.moves.push(move);
    return { ok: true, seq };
  }

  finish(session: PuzzleSession, hash: string | null): FinishOutcome {
    if (session.closed) return { ok: false, reason: "deadline" };
    if (hash !== null && session.def.hash(session.state) !== hash) {
      this.close(session);
      return { ok: false, reason: "divergence" };
    }
    this.close(session);
    return { ok: true, state: session.state, summary: session.def.summarize(session.state), moves: session.moves };
  }

  /** True once the round has run its clock or the engine ended it: the only rounds a duty board is rated for. */
  ranFull(session: PuzzleSession): boolean {
    return this.opts.now() >= session.deadlineAt - this.opts.graceMs || session.def.isFinished(session.state);
  }

  /** The score so far, for a ship taking a station's output mid-round. */
  score(session: PuzzleSession): number {
    return session.def.summarize(session.state).score;
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
