import { InvalidMoveError, PUZZLES, type AnyPuzzleDef, type DutyPuzzleId, type PuzzleId, type PuzzleSummary } from "@openseas/engine";

export type RejectReason = "divergence" | "illegal_move" | "bad_sequence" | "deadline" | "too_many_moves";

/** A round played at a ship's station rather than on a practice page. */
export interface DutyBinding {
  readonly shipId: string;
  readonly station: DutyPuzzleId;
  readonly voyageId: string;
  /** Bilging only: the ship's bilge in rows when the board is dealt. */
  readonly water?: number;
}

/** The captain's sea battle aboard a ship (M4). Its tokens, loads and hull come from the ship. */
export interface BattleBinding {
  readonly shipId: string;
  readonly voyageId: string;
  readonly tierId: string;
}

/** A pirate's board in a boarding melee aboard a ship (M5). Its foes are outside it; the server routes the attacks. */
export interface MeleeBinding {
  readonly shipId: string;
  readonly voyageId: string;
  readonly tierId: string;
}

/** Wrack the server announced to a melee board, not yet logged. The board's next incoming move must say exactly this. */
export interface MeleeIncoming {
  readonly wrack: number;
  readonly blade: number;
}

/** What the ship brings the battle board at a turn. The board must log a supply move that says exactly this. */
export interface ShipSupply {
  readonly left: number;
  readonly forward: number;
  readonly right: number;
  readonly cannons: number;
  readonly hull: number;
}

/** A round dealt with its own config and length rather than content's: the battle aboard a ship. */
export interface RoundOverride {
  readonly config: unknown;
  readonly roundMs: number;
}

function isWaterMove(move: unknown): move is { type: "water"; row: number } {
  return typeof move === "object" && move !== null && (move as { type?: unknown }).type === "water";
}

function isSupplyMove(move: unknown): move is { type: "supply" } & ShipSupply {
  return typeof move === "object" && move !== null && (move as { type?: unknown }).type === "supply";
}

function isIncomingMove(move: unknown): move is { type: "incoming"; board: number; wrack: number; blade: number; tick: number } {
  return typeof move === "object" && move !== null && (move as { type?: unknown }).type === "incoming";
}

function isEndMove(move: unknown): move is { type: "end"; won?: unknown } {
  return typeof move === "object" && move !== null && (move as { type?: unknown }).type === "end";
}

const sameSupply = (a: ShipSupply, b: ShipSupply): boolean => a.left === b.left && a.forward === b.forward && a.right === b.right && a.cannons === b.cannons && a.hull === b.hull;

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
  /** Set when the round is the captain's sea battle aboard a ship. */
  readonly battle: BattleBinding | null;
  /** Set when the round is the pirate's board in a boarding melee. */
  readonly melee: MeleeBinding | null;
  /** Melee only: wrack announced to this board, oldest first, each to be logged as an incoming move in turn. */
  meleeIncoming: MeleeIncoming[];
  /** Bilging duty only: the ship's bilge in rows as last told to the client. A water move must say this. */
  shipWaterRow: number | null;
  /** Battle aboard only: the ship's latest deal, not yet logged by the board. A supply move must say this. */
  shipSupply: ShipSupply | null;
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

  start(pirateId: string, puzzle: PuzzleId, duty: DutyBinding | null = null, battle: BattleBinding | null = null, override: RoundOverride | null = null, melee: MeleeBinding | null = null): PuzzleSession {
    const now = this.opts.now();
    const seed = this.opts.randomSeed();
    const def = PUZZLES[puzzle];
    const content = override?.config ?? this.opts.puzzles[puzzle].config;
    const roundMs = override?.roundMs ?? this.opts.puzzles[puzzle].roundMs;
    if (override) def.validateConfig(override.config);
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
      battle,
      melee,
      meleeIncoming: [],
      shipWaterRow: duty?.water ?? null,
      shipSupply: null,
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
    // So is a battle's supply: the deal the ship announced, logged once.
    if (isSupplyMove(move) && (session.shipSupply === null || !sameSupply(move, session.shipSupply))) return this.reject(session, "illegal_move", seq);
    // And a melee board's incoming wrack: what the server announced, in the order it did.
    if (isIncomingMove(move)) {
      const head = session.meleeIncoming[0];
      if (!session.melee || !head || move.board !== 0 || move.wrack !== head.wrack || move.blade !== head.blade) return this.reject(session, "illegal_move", seq);
    }
    // A win over foes outside the board is the server's word alone (ADR 0022); the server writes that end itself.
    if (isEndMove(move) && move.won === true) return this.reject(session, "illegal_move", seq);
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
    if (isSupplyMove(move)) session.shipSupply = null;
    if (isIncomingMove(move)) session.meleeIncoming.shift();
    return { ok: true, seq };
  }

  /**
   * A move the server makes on a board itself (the melee's end, ADR 0022): applied and logged
   * without a client hash, so the persisted log still replays. Returns false when the engine refuses it.
   */
  inject(session: PuzzleSession, move: unknown): boolean {
    if (session.closed) return false;
    try {
      session.state = session.def.reduce(session.state, move);
    } catch (e) {
      if (e instanceof InvalidMoveError) return false;
      throw e;
    }
    session.moves.push(move);
    return true;
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
