import {
  InvalidMoveError,
  PUZZLES,
  pureMoveRejection,
  soloHeatStart,
  soloHeatTurn,
  soloHeatTurnsDue,
  type AnyPuzzleDef,
  type HeatBoardFields,
  type PuzzleId,
  type PuzzleSummary,
  type RejectReason,
  type ShipRules,
  type SoloHeat,
} from "@openseas/engine";
import { PRACTICE, bindingPolicy, type SessionBinding } from "./binding.js";
import { VouchedMoves } from "./vouched.js";

export type { RejectReason };

/** A round dealt with its own config and length rather than content's: the battle or a melee board aboard a ship. */
export interface RoundOverride {
  readonly config: unknown;
  readonly roundMs: number;
}

/** How a round is dealt: what it is played for and, aboard, the ship's own config. */
export interface SessionStart {
  readonly binding: SessionBinding;
  readonly override?: RoundOverride;
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
  /** What the round is played for: practice, a ship's station, the captain's battle or a melee board. */
  readonly binding: SessionBinding;
  /**
   * The moves the server vouched for that the board may log (ADR 0042): the ship's heat, from the
   * ship aboard or the lone ship below, the battle's supply, a melee's incoming scrap.
   */
  readonly vouched: VouchedMoves;
  /** A harness Cooling round's lone ship (ADR 0029): its heat, and how many of its turns have passed. */
  soloHeat: { heat: SoloHeat; turns: number } | null;
  state: unknown;
  moves: unknown[];
  closed: boolean;
  /** Times this board was handed back to its client after a move went missing (ADR 0024). */
  resyncs: number;
  /** Handed back and not yet heard from at the right number: moves still in flight from the old board are dropped. */
  resyncing: boolean;
}

/** A ship's board handed back this many times is thrown out on the next missing move. */
export const MAX_RESYNCS = 3;

/**
 * `resync`: the move's number was not the next one, and the board is one its client can rebuild
 * from the server's log (a melee or a space battle). `handBack` is true when the caller must send it
 * back now; false while an earlier hand-back is still on its way and the move is just dropped.
 */
export type MoveOutcome =
  | { ok: true; seq: number }
  | { ok: false; reason: RejectReason; atSeq: number }
  | { ok: "resync"; atSeq: number; handBack: boolean };

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
  /**
   * The ship a harness Cooling round plays against (ADR 0029): the class's rules and Cooling's par
   * for one turn. Without it a harness Cooling board's heat never moves from the deal.
   */
  soloHeat?: { rules: ShipRules; par: number };
}

/**
 * Authoritative puzzle sessions (ADR 0003) for every engine in the registry. Replays each client
 * move as it arrives and rejects the round on the first divergence, illegal move, or sequencing
 * error. Holds no I/O: the service layer persists outcomes.
 */
export class PuzzleSessionManager {
  private readonly sessions = new Map<string, PuzzleSession>();
  /** The round each pirate was dealt last, while it is open. */
  private readonly open = new Map<string, PuzzleSession>();

  constructor(private readonly opts: SessionManagerOptions) {
    for (const id of Object.keys(opts.puzzles) as PuzzleId[]) PUZZLES[id].validateConfig(opts.puzzles[id].config);
  }

  /** Deal a round. Without `opts` it is a practice round on content's config. */
  start(pirateId: string, puzzle: PuzzleId, opts: SessionStart = { binding: PRACTICE }): PuzzleSession {
    const { binding, override } = opts;
    const now = this.opts.now();
    const seed = this.opts.randomSeed();
    const def = PUZZLES[puzzle];
    const content = override?.config ?? this.opts.puzzles[puzzle].config;
    const roundMs = override?.roundMs ?? this.opts.puzzles[puzzle].roundMs;
    if (override) def.validateConfig(override.config);
    // A Cooling board's heat is a ship's heat (DESIGN.md 3.3): the ship's aboard, a lone ship's in the harness.
    const config = puzzle === "cooling" ? { ...(content as object), shipHeat: true } : content;
    const solo = puzzle === "cooling" && bindingPolicy(binding).loneShip ? soloHeatStart(config as HeatBoardFields) : null;
    const vouched = new VouchedMoves(def);
    // The board is dealt at the heat it plays from, which it logs as the ship's word.
    const heat = puzzle === "cooling" ? ((binding.kind === "duty" ? binding.heat : undefined) ?? solo?.row) : undefined;
    if (heat !== undefined) vouched.vouch({ type: "heat", row: heat });
    const session: PuzzleSession = {
      id: this.opts.randomId(),
      pirateId,
      puzzle,
      def,
      seed,
      config,
      startedAt: now,
      deadlineAt: now + roundMs,
      binding,
      vouched,
      soloHeat: solo ? { heat: solo, turns: 0 } : null,
      state: def.create(seed, config),
      moves: [],
      closed: false,
      resyncs: 0,
      resyncing: false,
    };
    this.sessions.set(session.id, session);
    this.open.set(pirateId, session);
    return session;
  }

  get(id: string): PuzzleSession | undefined {
    return this.sessions.get(id);
  }

  /** The pirate's open round: the one dealt to them last, until it closes. */
  openFor(pirateId: string): PuzzleSession | null {
    return this.open.get(pirateId) ?? null;
  }

  /**
   * Turn every harness Cooling round's lone ship that is due (ADR 0029), each from the points its
   * board earned since the last turn. Returns the boards whose heat now shows a different depth;
   * the caller tells their clients, which log the depth as a heat move, as a duty board does.
   */
  turnSoloHeat(): Array<{ session: PuzzleSession; row: number }> {
    const ship = this.opts.soloHeat;
    if (!ship) return [];
    const now = this.opts.now();
    const changed: Array<{ session: PuzzleSession; row: number }> = [];
    for (const s of this.sessions.values()) {
      if (s.closed || !s.soloHeat) continue;
      // The round's own clock ends at its deadline; no turn falls on or after it.
      const due = soloHeatTurnsDue(ship.rules, Math.min(now, s.deadlineAt - 1) - s.startedAt);
      if (s.soloHeat.turns >= due) continue;
      let heat = s.soloHeat.heat;
      const score = s.def.summarize(s.state).score;
      for (let t = s.soloHeat.turns; t < due; t++) heat = soloHeatTurn(ship.rules, ship.par, heat, score, s.config as HeatBoardFields);
      s.soloHeat = { heat, turns: due };
      if (s.vouched.vouch({ type: "heat", row: heat.row })) changed.push({ session: s, row: heat.row });
    }
    return changed;
  }

  /** `move` must already be validated against the session's puzzle schema. */
  move(session: PuzzleSession, seq: number, move: unknown, hash: string): MoveOutcome {
    if (session.closed) return { ok: false, reason: "deadline", atSeq: seq };
    if (seq !== session.moves.length) {
      // A move lost on the way (ADR 0024): a ship's board is handed back with the server's log
      // instead of thrown out. Moves the old board already sent are dropped until the new one speaks.
      if (session.resyncing) return { ok: "resync", atSeq: seq, handBack: false };
      if (this.canResync(session)) {
        session.resyncs += 1;
        session.resyncing = true;
        return { ok: "resync", atSeq: seq, handBack: true };
      }
      return this.reject(session, "bad_sequence", seq);
    }
    session.resyncing = false;
    const now = this.opts.now();
    // Late, or one too many: the rules a replay of the log holds it to as well.
    const ruled = pureMoveRejection(session.def, session.config, session.moves.length, move, { roundMs: session.deadlineAt - session.startedAt, graceMs: this.opts.graceMs, atMs: now - session.startedAt });
    if (ruled) return this.reject(session, ruled, seq);
    // A move the player does not make is the server's word, not the client's (ADR 0042): the ship's
    // heat, the battle's supply and a melee's incoming scrap must repeat what the server said, and a
    // win over foes outside the board the server writes itself (ADR 0022).
    if (!session.vouched.admits(move)) return this.reject(session, "illegal_move", seq);
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
    session.vouched.logged(move);
    return { ok: true, seq };
  }

  /** Boards whose client rebuilds from a resumed deal, up to a few times each. */
  private canResync(session: PuzzleSession): boolean {
    return bindingPolicy(session.binding).handsBack && session.resyncs < MAX_RESYNCS;
  }

  /**
   * True when a finish should be dropped unanswered: the board was handed back and this claim comes
   * from the old one, which no longer matches the server's log. The rebuilt board finishes again.
   */
  staleFinish(session: PuzzleSession, hash: string | null): boolean {
    return session.resyncing && hash !== null && session.def.hash(session.state) !== hash;
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
    if (this.open.get(session.pirateId) === session) this.open.delete(session.pirateId);
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
