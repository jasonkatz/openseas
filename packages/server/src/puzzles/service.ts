import { randomBytes, randomUUID } from "node:crypto";
import type { Content } from "@openseas/content";
import { PUZZLE_IDS, parPerTurn, type PuzzleId } from "@openseas/engine";
import { parseMoveFor, type ClientMetrics, type PuzzleIdWire, type PuzzleResult, type PuzzleStarted, type ServerMessage } from "@openseas/protocol";
import { schema, type Db } from "../db/index.js";
import { recordEvent } from "../events.js";
import type { Logger } from "../log.js";
import { rateDutyRound, roundPerformance } from "../ratings.js";
import { PuzzleSessionManager, type BattleBinding, type DutyBinding, type MeleeBinding, type PuzzleRoundOptions, type PuzzleSession, type RejectReason, type RoundOverride } from "./sessions.js";

// The protocol's puzzle ids and the engine's must be the same set. If this stops compiling, they drifted.
const _idCheck: (p: PuzzleIdWire) => PuzzleId = (p) => p;
const _idCheckBack: (p: PuzzleId) => PuzzleIdWire = (p) => p;
void _idCheck;
void _idCheckBack;

const GRACE_MS = 5_000;

/** Coordinates the in-memory session manager with persistence. One instance per process. */
export class PuzzleService {
  readonly sessions: PuzzleSessionManager;
  /**
   * Called once for every duty session as it ends, before it is closed, so the ship can take the
   * board's last points. Set by the ship service.
   */
  onDutyEnd: ((session: PuzzleSession) => void) | null = null;
  /** A battle session took a move: the ship reads what the turn did. Set by the ship service. */
  onBattleMove: ((session: PuzzleSession) => void) | null = null;
  /**
   * A battle session is over: scored, rejected or abandoned. Called after it is closed, with the
   * result sent to the captain if there was one. Set by the ship service.
   */
  onBattleEnd: ((session: PuzzleSession, how: "finished" | "rejected" | "abandoned", result: ServerMessage | null) => void) | null = null;
  /** A melee board took a move: the ship routes what it sent. Set by the ship service. */
  onMeleeMove: ((session: PuzzleSession) => void) | null = null;
  /** A melee board's session is over, however it ended. Called after it is closed. Set by the ship service. */
  onMeleeEnd: ((session: PuzzleSession, how: "finished" | "rejected" | "abandoned", result: ServerMessage | null) => void) | null = null;
  /**
   * A ship's board missed a move (ADR 0024): send its pirate the board as the server holds it, with
   * whatever the ship announced that the board has not logged yet. Set by the ship service.
   */
  onResync: ((session: PuzzleSession) => void) | null = null;
  /** A harness Bilging round's lone ship turned and its bilge moved (ADR 0029): tell its pirate. Set by the socket server. */
  onSoloWater: ((session: PuzzleSession, row: number) => void) | null = null;

  constructor(
    private readonly db: Db,
    private readonly content: Content,
    private readonly log: Logger,
    now: () => number = Date.now,
  ) {
    const puzzles = {} as Record<PuzzleId, PuzzleRoundOptions>;
    for (const id of PUZZLE_IDS) {
      const c = content.puzzles[id];
      puzzles[id] = { roundMs: c.roundSeconds * 1000, config: c.config };
    }
    this.sessions = new PuzzleSessionManager({
      graceMs: GRACE_MS,
      puzzles,
      now,
      randomSeed: () => randomBytes(16).toString("hex"),
      randomId: () => randomUUID(),
      soloBilge: { rules: content.world.ship, par: parPerTurn(content.world.ship, content.puzzles.bilging) },
    });
  }

  /** Once a second: turn the lone ships of harness Bilging rounds that are due, and pass on what moved. */
  tick(): void {
    for (const { session, row } of this.sessions.turnSoloBilges()) this.onSoloWater?.(session, row);
  }

  start(pirateId: string, puzzle: PuzzleId, duty: DutyBinding | null = null): PuzzleStarted {
    const s = this.sessions.start(pirateId, puzzle, duty);
    void recordEvent(this.db, pirateId, "puzzle.started", { puzzle, sessionId: s.id, ...(duty ? { voyageId: duty.voyageId } : {}) }).catch((e) =>
      this.log.warn({ err: e }, "event write failed"),
    );
    return this.startedMessage(s);
  }

  /** Deal the captain's sea battle aboard a ship, on the ship's own config (the tier, the guns, the ship's turn). */
  startBattle(pirateId: string, battle: BattleBinding, override: RoundOverride): PuzzleStarted {
    const s = this.sessions.start(pirateId, "battle", null, battle, override);
    void recordEvent(this.db, pirateId, "puzzle.started", { puzzle: "battle", sessionId: s.id, voyageId: battle.voyageId, tierId: battle.tierId }).catch((e) =>
      this.log.warn({ err: e }, "event write failed"),
    );
    return this.startedMessage(s);
  }

  /** Deal a pirate's board in a boarding melee, on the melee's config (no foes in it; the brigand crew is outside). */
  startMelee(pirateId: string, melee: MeleeBinding, override: RoundOverride): PuzzleStarted {
    const s = this.sessions.start(pirateId, "swordfight", null, null, override, melee);
    void recordEvent(this.db, pirateId, "puzzle.started", { puzzle: "swordfight", sessionId: s.id, voyageId: melee.voyageId, tierId: melee.tierId }).catch((e) =>
      this.log.warn({ err: e }, "event write failed"),
    );
    return this.startedMessage(s);
  }

  /**
   * The server's word on a melee board (ADR 0022): the end move, written into the log here, then
   * the round scored. Returns the result sent to the pirate, or null when the session was gone.
   */
  async endMelee(session: PuzzleSession, won: boolean, tick: number): Promise<ServerMessage | null> {
    if (session.closed) return null;
    this.sessions.inject(session, { type: "end", won, tick });
    return this.finish(session, null, null);
  }

  /** The deal as the client sees it; with `resume`, a battle the captain reconnected to. */
  startedMessage(s: PuzzleSession, resume = false): PuzzleStarted {
    const duty = s.duty;
    // The config came from content (or the ship's override) for this puzzle, so it matches the wire variant for `puzzle`.
    return {
      type: "puzzle.started",
      sessionId: s.id,
      puzzle: s.puzzle,
      seed: s.seed,
      config: s.config,
      deadlineAt: s.deadlineAt,
      serverNow: s.startedAt,
      ...(duty ? { duty: { shipId: duty.shipId, station: duty.station, ...(duty.water !== undefined ? { water: duty.water } : {}) } } : {}),
      ...(s.battle ? { battle: { shipId: s.battle.shipId, tierId: s.battle.tierId } } : {}),
      ...(s.melee ? { melee: { shipId: s.melee.shipId, tierId: s.melee.tierId } } : {}),
      ...(resume ? { resume: { moves: s.moves } } : {}),
    } as PuzzleStarted;
  }

  /** Returns the message to send back, if any. `move` is any puzzle's move; it is narrowed here. */
  async move(session: PuzzleSession, seq: number, move: unknown, hash: string): Promise<ServerMessage | null> {
    const parsed = parseMoveFor(session.puzzle, move);
    const expected = session.moves.length;
    const r = parsed === null ? this.sessions.move(session, seq, { type: "__not_a_move__" }, hash) : this.sessions.move(session, seq, parsed, hash);
    if (r.ok === "resync") {
      if (r.handBack) {
        this.log.warn({ pirateId: session.pirateId, sessionId: session.id, puzzle: session.puzzle, seq, expected, resyncs: session.resyncs }, "board handed back after a missing move");
        this.onResync?.(session);
      }
      return null;
    }
    if (r.ok) {
      if (session.battle) this.onBattleMove?.(session);
      if (session.melee) this.onMeleeMove?.(session);
      return null;
    }
    // A rejected duty board still fed the ship what it had earned before the bad move.
    if (session.duty) this.onDutyEnd?.(session);
    await this.persistRejected(session, r.reason, null, { seq, expected });
    const rejected: ServerMessage = { type: "puzzle.rejected", sessionId: session.id, reason: r.reason, atSeq: r.atSeq };
    if (session.battle) this.onBattleEnd?.(session, "rejected", rejected);
    if (session.melee) this.onMeleeEnd?.(session, "rejected", rejected);
    return rejected;
  }

  /**
   * Score a round. Standing is earned in the game only (ADR 0028): the captain's sea battle and a
   * melee board always move it, a duty board only when it ran its full clock or the engine ended it
   * (a board cut short by docking counts but moves no standing), and a harness round never does.
   * Every scored round gets its own performance rating against the thresholds.
   */
  async finish(session: PuzzleSession, hash: string | null, metrics: ClientMetrics | null): Promise<ServerMessage> {
    const rated = session.battle !== null || session.melee !== null || (session.duty !== null && this.sessions.ranFull(session));
    this.endDuty(session);
    const r = this.sessions.finish(session, hash);
    if (!r.ok) {
      await this.persistRejected(session, r.reason, metrics);
      const rejected: ServerMessage = { type: "puzzle.rejected", sessionId: session.id, reason: r.reason };
      if (session.battle) this.onBattleEnd?.(session, "rejected", rejected);
      if (session.melee) this.onMeleeEnd?.(session, "rejected", rejected);
      return rejected;
    }
    const performance = roundPerformance(this.content, session.puzzle, r.summary.score);
    const result = await this.db.transaction(async (tx) => {
      const rating = rated ? await rateDutyRound(tx, this.content, session.pirateId, session.puzzle, r.summary.score) : null;
      await tx.insert(schema.puzzleRound).values({
        id: session.id,
        pirateId: session.pirateId,
        puzzle: session.puzzle,
        seed: session.seed,
        score: r.summary.score,
        moves: r.summary.moves,
        bestCombo: r.summary.bestCombo,
        rejectedReason: null,
        voyageId: session.duty?.voyageId ?? session.battle?.voyageId ?? session.melee?.voyageId ?? null,
        rated,
        performance: performance.rating,
        moveLog: r.moves as unknown[],
        metrics: metrics ?? null,
        startedAt: new Date(session.startedAt),
      });
      await recordEvent(tx, session.pirateId, "puzzle.completed", {
        puzzle: session.puzzle,
        sessionId: session.id,
        score: r.summary.score,
        moves: r.summary.moves,
        rated,
        performance: performance.rating,
        ...(session.duty ? { voyageId: session.duty.voyageId, shipId: session.duty.shipId } : {}),
        ...(session.battle ? { voyageId: session.battle.voyageId, shipId: session.battle.shipId, tierId: session.battle.tierId } : {}),
        ...(session.melee ? { voyageId: session.melee.voyageId, shipId: session.melee.shipId, tierId: session.melee.tierId } : {}),
        ...(rating ? { ratingBefore: rating.before.rating, ratingAfter: rating.after.rating } : {}),
        ...(metrics ? { metrics } : {}),
      });
      const msg: PuzzleResult = {
        type: "puzzle.result",
        sessionId: session.id,
        score: r.summary.score,
        moves: r.summary.moves,
        bestCombo: r.summary.bestCombo,
        verified: true,
        rating: rating ? rating.view : null,
        tierChange: rating ? rating.tierChange : null,
        performance,
      };
      return msg;
    });
    this.log.info({ pirateId: session.pirateId, puzzle: session.puzzle, score: result.score, moves: result.moves, rated }, "round scored");
    if (session.battle) this.onBattleEnd?.(session, "finished", result);
    if (session.melee) this.onMeleeEnd?.(session, "finished", result);
    return result;
  }

  async abandon(session: PuzzleSession): Promise<void> {
    this.endDuty(session);
    this.sessions.close(session);
    await this.persistRejected(session, "deadline", null);
    if (session.battle) this.onBattleEnd?.(session, "abandoned", null);
    if (session.melee) this.onMeleeEnd?.(session, "abandoned", null);
  }

  /**
   * End a duty board early (the ship docked, the pirate stood down or dropped). A board with moves
   * counts, unrated; an untouched one is dropped. Returns the result to send, if any.
   */
  async cutShort(session: PuzzleSession): Promise<ServerMessage | null> {
    if (session.closed) return null;
    if (session.moves.length === 0) {
      this.endDuty(session);
      this.sessions.close(session);
      return null;
    }
    return this.finish(session, null, null);
  }

  private endDuty(session: PuzzleSession): void {
    if (session.duty && !session.closed) this.onDutyEnd?.(session);
  }

  /**
   * Score rounds whose clock ran out without a finish message (the player closed the tab). Rounds
   * with moves count, with what the server received; empty rounds are dropped.
   */
  async sweep(): Promise<void> {
    for (const s of this.sessions.expired()) {
      try {
        if (s.moves.length === 0) {
          this.sessions.close(s);
          continue;
        }
        await this.finish(s, null, null);
      } catch (e) {
        this.log.error({ err: e, sessionId: s.id }, "sweep failed");
        this.sessions.close(s);
      }
    }
  }

  /** `at`: for a rejected move, the number it carried and the number the server was waiting for. */
  private async persistRejected(session: PuzzleSession, reason: RejectReason, metrics: ClientMetrics | null, at?: { seq: number; expected: number }): Promise<void> {
    this.log.warn({ pirateId: session.pirateId, sessionId: session.id, puzzle: session.puzzle, reason, ...at }, "round rejected");
    const summary = session.def.summarize(session.state);
    try {
      await this.db.insert(schema.puzzleRound).values({
        id: session.id,
        pirateId: session.pirateId,
        puzzle: session.puzzle,
        seed: session.seed,
        score: summary.score,
        moves: session.moves.length,
        bestCombo: summary.bestCombo,
        rejectedReason: reason,
        voyageId: session.duty?.voyageId ?? session.battle?.voyageId ?? session.melee?.voyageId ?? null,
        rated: false,
        moveLog: session.moves as unknown[],
        metrics: metrics ?? null,
        startedAt: new Date(session.startedAt),
      });
      await recordEvent(this.db, session.pirateId, "puzzle.rejected", { puzzle: session.puzzle, sessionId: session.id, reason });
    } catch (e) {
      this.log.error({ err: e }, "failed to persist rejected round");
    }
  }
}
